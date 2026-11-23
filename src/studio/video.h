/* ReBeep Studio: the 80x25 colour text screen. Everything is drawn into a back buffer of
   char/attribute words and flushed to B800:0000 in one go. SPDX-License-Identifier: MIT */
#ifndef RBSTUDIO_VIDEO_H
#define RBSTUDIO_VIDEO_H

#define VIDEO_COLS 80
#define VIDEO_ROWS 25

/* Forces 80x25 colour text, turns blink off (bit 7 of an attribute then selects a bright
   background), hides the cursor and clears the back buffer. video_restore() undoes it and is
   registered to run at exit; it also clears the screen. Safe to call again. */
void video_init(void);
void video_restore(void);

/* Back-buffer drawing. Coordinates are 0-based; anything off the screen is clipped. */
void video_put(int x, int y, unsigned char ch, unsigned char attr);
void video_fill(int x, int y, int w, int h, unsigned char ch, unsigned char attr);
void video_text(int x, int y, const char *s, unsigned char attr);

/* Copies the whole back buffer to the screen. */
void video_flush(void);

#endif
