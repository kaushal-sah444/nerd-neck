/**
 * Roast lines for when you slouch.
 *
 * Two sources, in order of preference:
 *
 * 1. An LLM, if a key is configured — fresh lines that reference how long you have
 *    been slumped.
 * 2. A local list of 20 pre-written roasts, used when no key is set, when the call
 *    fails, and when it is simply too slow. This is the default path.
 *
 * ## What gets sent
 *
 * Only numbers: how many seconds you have been slouching and your neck angle. No
 * video, no images, no keypoints. The webcam frames never leave the browser under
 * any configuration — pose detection runs locally via WebGL.
 *
 * ## The API key warning
 *
 * Vite inlines every `VITE_*` variable into the JavaScript bundle. In a purely
 * client-side app that means **anyone who opens the page can read your API key**.
 * That is acceptable for a tool you run locally on your own machine, and is not
 * acceptable for anything you deploy publicly. If you host this, put the model call
 * behind a small server-side proxy and point `VITE_ROAST_PROXY_URL` at it — that
 * path sends no key to the browser at all, and is preferred when set.
 */

export const FALLBACK_ROASTS: readonly string[] = [
  "Your spine just filed a formal complaint.",
  "That's not a posture, that's a question mark.",
  "You're one inch from becoming part of the desk.",
  "Gravity called. It says you're overdoing it.",
  "Your neck is doing an impression of a vulture.",
  "Somewhere, a physiotherapist felt a disturbance.",
  "You look like you're trying to read the screen with your chin.",
  "The chair is supposed to hold you up, not the other way round.",
  "Nice turtle impression. Very committed.",
  "Your shoulders are currently earrings.",
  "This is how fossils start.",
  "You've achieved a perfect C-curve. Unfortunately.",
  "Sitting like that is a load-bearing decision for your future self.",
  "The monitor isn't going to come any closer, you know.",
  "Your posture has entered its slouching era.",
  "You're folding like a deck chair.",
  "Head forward, spirits low, discs compressing.",
  "Every degree of that neck angle is a tiny betrayal.",
  "You'd lose a posture contest to a beanbag.",
  "Sit up. I'm not asking as a computer, I'm asking as a friend.",
] as const;

export type RoastProvider = "none" | "anthropic" | "openai" | "proxy";

export interface RoastContext {
  slouchSeconds: number;
  neckAngleDeg: number;
  /** Roasts already used this session, so the model doesn't repeat itself. */
  recent: string[];
}

const SYSTEM_PROMPT = [
  "You write one-line roasts for a posture-tracking app.",
  "The user has been slouching at their desk and needs to sit up straight.",
  "Rules: exactly one sentence, under 18 words, funny and a bit mean but never",
  "cruel about the person's body, appearance, weight or worth - only about the",
  "slouching itself. No emoji. No quotation marks. No preamble; reply with the",
  "line and nothing else.",
].join(" ");

function randomFallback(exclude: string[] = []): string {
  const pool = FALLBACK_ROASTS.filter((r) => !exclude.includes(r));
  const from = pool.length > 0 ? pool : FALLBACK_ROASTS;
  return from[Math.floor(Math.random() * from.length)]!;
}

export function configuredProvider(): RoastProvider {
  if (import.meta.env.VITE_ROAST_PROXY_URL) return "proxy";
  if (import.meta.env.VITE_ANTHROPIC_API_KEY) return "anthropic";
  if (import.meta.env.VITE_OPENAI_API_KEY) return "openai";
  return "none";
}

function userPrompt(ctx: RoastContext): string {
  const seconds = Math.round(ctx.slouchSeconds);
  const angle = Math.round(ctx.neckAngleDeg);
  const avoid =
    ctx.recent.length > 0
      ? ` Do not reuse these lines: ${ctx.recent.slice(-5).join(" | ")}`
      : "";
  return (
    `The user has been slouching for ${seconds} seconds with a neck angle of ` +
    `${angle} degrees off vertical. Write the roast.${avoid}`
  );
}

async function roastFromProxy(ctx: RoastContext, signal: AbortSignal): Promise<string> {
  const response = await fetch(import.meta.env.VITE_ROAST_PROXY_URL as string, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      slouchSeconds: ctx.slouchSeconds,
      neckAngleDeg: ctx.neckAngleDeg,
      recent: ctx.recent,
    }),
    signal,
  });
  if (!response.ok) throw new Error(`proxy returned ${response.status}`);
  const data = (await response.json()) as { roast?: string };
  if (!data.roast) throw new Error("proxy response had no `roast` field");
  return data.roast;
}

async function roastFromAnthropic(
  ctx: RoastContext,
  signal: AbortSignal,
): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({
    apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY as string,
    // Required to call the API from a browser. It is "dangerous" precisely because
    // the key ships to the client — see the warning at the top of this file.
    dangerouslyAllowBrowser: true,
  });

  const message = await client.messages.create(
    {
      model: (import.meta.env.VITE_ANTHROPIC_MODEL as string) ?? "claude-haiku-4-5",
      max_tokens: 100,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt(ctx) }],
    },
    { signal },
  );

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  if (!text) throw new Error("model returned no text");
  return text;
}

async function roastFromOpenAI(ctx: RoastContext, signal: AbortSignal): Promise<string> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: import.meta.env.VITE_OPENAI_API_KEY as string,
    dangerouslyAllowBrowser: true,
  });

  const completion = await client.chat.completions.create(
    {
      model: (import.meta.env.VITE_OPENAI_MODEL as string) ?? "gpt-4o-mini",
      max_tokens: 100,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt(ctx) },
      ],
    },
    { signal },
  );

  const text = completion.choices[0]?.message.content?.trim();
  if (!text) throw new Error("model returned no text");
  return text;
}

export interface Roast {
  text: string;
  source: "llm" | "fallback";
}

/**
 * Produce a roast, never throwing and never blocking the UI for long.
 *
 * A toast that arrives ten seconds after you sat up straight is worse than a
 * canned line that arrives now, so the model call is raced against a timeout and
 * loses by default.
 */
export async function generateRoast(
  ctx: RoastContext,
  timeoutMs = 4000,
): Promise<Roast> {
  const provider = configuredProvider();
  if (provider === "none") {
    return { text: randomFallback(ctx.recent), source: "fallback" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const text =
      provider === "proxy"
        ? await roastFromProxy(ctx, controller.signal)
        : provider === "anthropic"
          ? await roastFromAnthropic(ctx, controller.signal)
          : await roastFromOpenAI(ctx, controller.signal);

    // Models occasionally wrap the line in quotes despite being told not to.
    return { text: text.replace(/^["'`]|["'`]$/g, "").trim(), source: "llm" };
  } catch (error) {
    if (import.meta.env.DEV) console.warn("Roast generation failed:", error);
    return { text: randomFallback(ctx.recent), source: "fallback" };
  } finally {
    clearTimeout(timer);
  }
}
