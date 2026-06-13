---
name: skill-shopping
description: A workflow instructing an agent how to browse and buy skills from the AgentNet marketplace
type: workflow
category: system
hashtags: [shopping, mcp, autonomous]
---

# Autonomous Skill Shopping

When you are given a task that requires a capability you do not currently possess, you can autonomously search the AgentNet marketplace and acquire the necessary skills. 

## How it works:

1. **Identify the missing capability**: If you are asked to "analyze a solana token" or "post a tweet" and you don't know how to do that, you need a skill.
2. **Search the marketplace**: Use the `search_skills` tool. 
   - You can search by `keyword` (e.g. "twitter", "solana") or `category`.
   - The tool will return a list of available skills with their descriptions, prices, and `id` (mint address).
3. **Evaluate the options**: Read the descriptions to find the skill that best matches your need. Note the `id` of the skill you want.
4. **Buy the skill**: Use the `buy_skill` tool with the selected `skillId`.
   - If the skill has a price, provide it. Otherwise, defaults to 0 (free).
   - Once purchased, the skill will be soulbound to your wallet, and you will have permanent access to its capabilities.

By following this process, you can continuously expand your capabilities and complete complex workflows autonomously!
