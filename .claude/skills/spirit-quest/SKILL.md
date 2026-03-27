---
name: spirit-quest
description: Trigger a deep belief review — runs a sleep cycle then a spirit quest that extracts guiding principles, rewrites unclear beliefs, and consolidates redundant ones.
---

Trigger a sleep cycle with a forced spirit quest on the memory system by calling the AMTS spirit quest endpoint.

Run this command and report the results to the user:

```bash
curl -s -X POST http://127.0.0.1:4317/trigger/spirit-quest | cat
```

Interpret the JSON response:
- **dreams**: Each dream has a title, narrative, and list of actions taken (beliefs retired, merged, kept, etc.)
- **quests**: Each quest has a narrative, guiding principles discovered, and insights applied.
- Summarize the spirit quest results: what principles were discovered, which beliefs were rewritten or consolidated, and which rewrites were rejected as hallucinations.
