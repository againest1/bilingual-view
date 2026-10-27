// Fixed benchmark from statusline-first-chunk-en-12e0645c.txt; keep its full text unchanged.
export const TRANSLATION_SPEED_SAMPLE = `Here's what each of the last four triggers does, based on the current statusline docs.

## 1. Changing BV_LITERAL_0_END in your BV_LITERAL_1_END settings

Claude Code watches your settings files. When the BV_LITERAL_2_END value changes, for example after you edit BV_LITERAL_3_END or run BV_LITERAL_4_END, the new command runs right away. This is the only trigger that skips the 300ms debounce, so the result of a config change shows up immediately.

**Catch:** this applies only to the BV_LITERAL_5_END string in settings. If your setting points to a script like BV_LITERAL_6_END and you edit that file, nothing reruns. Your edits show up at the next trigger of any kind, such as a new assistant message or a BV_LITERAL_7_END tick.

## 2. BV_LITERAL_8_END

BV_LITERAL_9_END

- This reruns the command every N seconds. The minimum is 1.
- It runs **in addition to** the event triggers and doesn't replace them. If you leave it unset, the script runs only on events.
- It's meant for things that change while Claude Code is idle:
  - a clock or elapsed time
  - git state that background subagents change while the main session waits
  - anything else your script reads from outside (CI status, files)

**Catch:** if a new update arrives while your script is still running, the running script is cancelled. That means a script that takes longer than the interval can keep getting cancelled before it finishes, and the status line will rarely update. Keep the script well under the interval. The docs suggest caching slow calls like BV_LITERAL_10_END in a temp file and refreshing that file every few seconds.

## 3. A rate-limit window reaches its BV_LITERAL_11_END

The JSON your script receives can include:

BV_LITERAL_12_END

- BV_LITERAL_13_END is present only for BV_LITERAL_14_END BV_LITERAL_15_END subscribers, or behind a Claude apps gateway that sets a spend limit. It appears only after the session's first API response.
- Claude Code reads the BV_LITERAL_16_END timestamps (Unix epoch seconds) from the last data it sent your script. When one of those times passes, it removes that window from the JSON and reruns your script.
- **Why it matters:** without this, an idle session would keep showing BV_LITERAL_17_END long after the window reset. With it, that segment updates without you doing anything.
- Your script has to handle the missing window, for example with BV_LITERAL_18_END. Each window can be absent independently of the others.

## 4. A warm prompt cache reaches its BV_LITERAL_19_END

The BV_LITERAL_20_END object (Claude Code BV_LITERAL_21_END or later) describes the main conversation's prompt cache:

BV_LITERAL_22_END

- BV_LITERAL_23_END is when the cached prefix reaches the end of its TTL (BV_LITERAL_24_END or BV_LITERAL_25_END) and goes cold.
- If the cache was warm in the last data your script received, Claude Code reruns the script at BV_LITERAL_26_END. BV_LITERAL_27_END is defined as BV_LITERAL_28_END so the new run should see BV_LITERAL_29_END. A segment showing BV_LITERAL_30_END switches to BV_LITERAL_31_END at the right moment instead of whenever your next message arrives.
- If BV_LITERAL_32_END is BV_LITERAL_33_END, meaning the last response reported no cache tokens, no timer is set.
- **Why it matters:** once the cache is cold, your next request has to write BV_LITERAL_34_END tokens to the cache again. Showing that on the status line tells you whether replying now is cheaper than replying later.
- Only the main conversation counts. Subagent`;
