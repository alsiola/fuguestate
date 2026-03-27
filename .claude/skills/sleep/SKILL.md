---
name: sleep
description: Trigger a memory sleep cycle — scans beliefs for contradictions and dreams about any conflicts found.
---

Trigger a sleep cycle on the memory system by calling the AMTS sleep endpoint.

Run this command and report the results to the user:

```bash
curl -s -X POST http://127.0.0.1:4317/trigger/sleep | cat
```

Interpret the JSON response:
- **dreams**: Each dream has a title, narrative, and list of actions taken (beliefs retired, merged, kept, etc.)
- **quests**: Should be empty for a regular sleep cycle.
- If both arrays are empty, report "Peaceful dreams — no conflicts found."
- Otherwise, summarize each dream: what beliefs were in conflict, how it was resolved, and what changed.
