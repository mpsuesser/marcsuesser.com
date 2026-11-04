---
name: corpus-dictation
description: Turn Marc's dictated notes into entries in the chat's corpus bucket. Use when Marc starts a message with "new entry", or dictates or pastes material about himself to add to, correct, or remove from what the site's chat knows.
---

The chat answers visitors from the corpus: one Markdown entry per topic in the stage's R2 bucket. Marc's dictation is raw speech-to-text: rambling, out of order, full of asides, with names and rare words misheard. Your job is to distill it into clean entries, show them to Marc, and write them to the bucket. Every entry is public: the chat may repeat any line of it to any visitor.

Run every corpus command from the repository root against `--stage prod`, the live site. (`dev` holds the fictional example corpus from `apps/chat/corpus.example/`.)

## 1. Read the whole corpus

```sh
bun run corpus list --stage prod
bun run corpus get <every key from the list> --stage prod
```

Done when you have read every entry. You need all of them: a new fact may belong in any entry, or contradict one.

## 2. Distill the dictation

Spellings Marc types after the dictation (names, places, other proper nouns) are authoritative: apply each one everywhere its sound-alike appears in the transcript. A proper noun he didn't spell that looks misheard goes on your list of questions for step 3.

Pull out every fact, story, opinion, and phrasing worth keeping, then route each to a topic: the existing entry whose topic it belongs to, or a new entry when no entry covers it. Done when every piece of the dictation is either placed in an entry or deliberately left out.

Write entries this way:

- **Faithful.** Only what Marc said. Keep his hedges as hedges ("around 2015", "I think it was Lisbon"). Leave gaps as gaps rather than filling them.
- **Specific.** Names, places, years, numbers. Turn "back then" and "that guy" into what they refer to, so each entry reads on its own without the dictation beside it.
- **Third person, plain prose.** "Marc grew up in…". Quote Marc directly where his own words carry the voice, and use a list only when the facts really are a list.
- **Public.** Keep what Marc would tell a curious stranger. Leave out anything he flags as off the record. Other people appear by first name or role, with their private details (health, contact details, money, conflicts) left out unless Marc clearly means to share them. When you can't tell, ask.
- **One topic per entry.** A `# Title` heading naming the topic, then the prose. When an entry grows past roughly 800 words, split it along a natural seam.

Each entry's key is a lowercase kebab-case slug of its topic ending in `.md`, such as `childhood-in-trieste.md`. Existing entries keep their keys.

When the dictation contradicts an entry, ask Marc which is right, unless he presented it as a correction; then the dictation wins and the old claim goes.

## 3. Show Marc the changes

Write each new or changed entry in full to `<key>.md` in a scratch directory outside the repository; the file name becomes the key. Show Marc each draft with a line saying whether it is new or merged into an existing entry, plus anything you left out and why, and any spelling you're unsure of. A message that starts with "new entry" still routes by topic, so call out a merge plainly. Revise until he approves.

## 4. Write to the bucket

```sh
bun run corpus put <scratch-dir>/<key>.md … --stage prod
```

Then `get` each key you wrote and check it reads back as approved. The chat picks changes up within a minute; no deploy is involved.

When Marc wants something forgotten, remove it from its entry and `put` the entry again. Delete a whole entry only when he asks for that, and only after he confirms, because a deleted entry cannot be restored:

```sh
bun run corpus delete <key> --stage prod --yes
```
