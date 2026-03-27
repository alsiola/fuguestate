---
name: spirit-quest
description: Trigger a deep belief review — runs a sleep cycle then a spirit quest that extracts guiding principles, rewrites unclear beliefs, and consolidates redundant ones.
---

Trigger a sleep cycle with a forced spirit quest on the memory system by calling the AMTS spirit quest endpoint.

**Arguments:** The user may optionally provide a style override in the format `band(name)`, `author(name)`, or any freeform style descriptor. This overrides the random IN_STYLE env var selection for this quest.

Examples:
- `/spirit-quest` — uses random style from IN_STYLE env var (or no style if unset)
- `/spirit-quest band(oasis)` — narrates in the style of Oasis
- `/spirit-quest author(cormac mccarthy)` — narrates in the style of Cormac McCarthy
- `/spirit-quest gonzo journalism` — narrates in gonzo journalism style

Parse the style from the argument. If a `band(...)` or `author(...)` wrapper is used, extract the name inside the parentheses. Otherwise use the entire argument as the style string.

Run this command and report the results to the user:

If no style argument was provided:
```bash
curl -s -X POST http://127.0.0.1:4317/trigger/spirit-quest | cat
```

If a style argument was provided (replace `STYLE_VALUE` with the extracted style):
```bash
curl -s -X POST http://127.0.0.1:4317/trigger/spirit-quest -H 'Content-Type: application/json' -d '{"style":"STYLE_VALUE"}' | cat
```

Interpret the JSON response:
- **dreams**: Each dream has a title, narrative, and list of actions taken (beliefs retired, merged, kept, etc.)
- **quests**: Each quest has a narrative, guiding principles discovered, and insights applied.
- Summarize the spirit quest results: what principles were discovered, which beliefs were rewritten or consolidated, and which rewrites were rejected as hallucinations.
