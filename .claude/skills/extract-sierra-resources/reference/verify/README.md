# Verify

Checks decoded sounds against the game's own loose `SOUND.NNN` copies, and checks each MIDI file's structure.

## Command

```
node "<skill>/reference/verify/verify.mjs" "<game root>" "<scratch>\<game>-out" "<scratch>\<game>-midi"
```

The MIDI folder is optional.

## Reading the output

- **Identical:** the decoder reproduces the loose copy exactly.
- **Differ:** the count of differing bytes. One byte is what Space Quest III's LZW sounds show. That single byte is channel 0's voice count, which may mean the loose copy came from a different build. Large counts mean the decode is wrong for that resource.
- **MIDI valid:** every file has the header, track length and end-of-track marker of a format-0 file. This doesn't check the music.
