# Identify

Run this first on any new game. It says whether the folder is a supported SCI0 game, which volumes and loose files it has, and where the game root is.

## Setup

Extract the zip into a new empty scratch folder. Don't run anything from it.

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory('<zip path>', '<new empty folder>')
```

## Command

```
node "<skill>/reference/identify/identify.mjs" "<extracted folder>"
```

The folder can be the zip root. The script looks one level down for `RESOURCE.MAP` and prints the game root to pass to the next steps.

## Reading the output

- `engine: SCI0 map` means the next steps apply.
- `not supported yet` (SCI1 or later) or AGI markers mean stop and tell the user.
- Space Quest III: 932 map entries, 86 sound and 4 patch resources, volumes `RESOURCE.001` to `RESOURCE.006`.
- King's Quest IV: 967 map entries, 80 sound and 4 patch resources, one volume (`RESOURCE.001`). Its map ends with a word of `0xffff` followed by zeros, and the reader stops at that word.
