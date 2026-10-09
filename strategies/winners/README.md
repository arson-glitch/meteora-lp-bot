# Generated winners

`npm run tournament` rewrites the JSON files in this directory. Each file is the strategy that won one coin-type bucket on the confirmation window. The loader treats them as normal strategies. They only match pools in their `coinType`, and their priority is higher than the hand-written placeholders.

If a bucket does not clear the sample and test-median guards, this directory has no file for it. Placeholders in the parent directory stay the fallback.
