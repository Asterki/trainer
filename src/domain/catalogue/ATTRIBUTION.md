# Exercise catalogue attribution

The committed file `wger-exercises.json` contains text-only exercise metadata
derived from the public [wger](https://wger.de/) exercise database.

- **Source API:** https://wger.de/api/v2/exerciseinfo/?language=2&limit=100
- **Retrieved:** 2026-11-17
- **Exercises kept:** 813
- **Images/videos:** none. No wger media is bundled or redistributed.

## Licenses reported by wger

- **CC-BY-SA 4** — Creative Commons Attribution Share Alike 4
  - https://creativecommons.org/licenses/by-sa/4.0/deed.en
  - 815 exercises; 214 recorded authors.
- **CC-BY-SA 3** — Creative Commons Attribution Share Alike 3
  - https://creativecommons.org/licenses/by-sa/3.0/deed.en
  - 132 exercises; 37 recorded authors.
- **CC0** — Creative Commons Public Domain 1.0
  - http://creativecommons.org/publicdomain/zero/1.0/
  - 26 exercises; 9 recorded authors.

Exercise text and metadata are contributed by individual wger authors; the
author for each source exercise is recorded in the wger API. Attribution to
wger and those authors is retained here and in Trainer's Settings → About.

## Obligations

Where a license is **CC-BY-SA**, redistribution of the derived catalogue must
credit wger and the original author(s), link to the license, indicate changes
(the text is HTML-stripped, capped and mapped into Trainer's taxonomy), and
share adaptations under the same license. **CC0** and **ODbL** records retain
their respective terms. Trainer is a personal, non-commercial application and
does not bundle wger images.

## Changes made

- Kept English translations with a category and at least one mapped primary
  muscle.
- Mapped wger muscle and equipment names into Trainer's fixed taxonomy.
- Deduplicated by case/punctuation-insensitive name, keeping the lowest wger id.
- Converted descriptions to plain text and capped them at 1200
  characters.
- Category overrides: Cardio → Full body.

