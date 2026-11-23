# Unpack

Decodes every sound (type 4) and patch (type 9) resource to a `.bin` file in a scratch folder.

## Command

```
node "<skill>/reference/unpack/unpack.mjs" "<game root>" "<scratch>\<game>-out"
```

Use the game root that identify printed.

## Output

- `sound-NNN.bin`: the sound body, starting at the flag byte. The `0x84 0x00` type word that appears in loose files is not included.
- `patch-NNN.bin`: the patch body.
- `INDEX.txt`: one line per resource with its method, size and comparison with the loose copy.

## Reading the output

- Failures show a reason. A `FAIL` line means nothing was written for that resource.
- Loose files start with a type word (`0x84 0x00` for sound, `0x89 0x00` for patch). The script strips it before comparing.
- King's Quest IV: 84 resources (80 sounds, 4 patches) decode with no failures, all raw. The loose `PATCH.101` in the game root differs from the decode in 72 bytes, so that one is unverified. The `patch\` subfolder holds loose copies the game does not load. The script ignores them, and patch 3 there matches the decode exactly.
- Space Quest III: 86 sounds and 4 patches decode with no failures. The LZW sounds differ from their loose copies by one byte. The three raw (method 0) sounds, 76, 80 and 96, differ widely, so their output is unverified.
