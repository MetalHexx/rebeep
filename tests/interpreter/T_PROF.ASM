; T_PROF - the startup part's game profile parser (startup/profile.asm): a .RBG text into the rule
; and effect table, its numbers, IDs and WHILEs, the names it checks, every reason a file is
; refused, and each limit. The parser runs on text buffers; loading the patches is P_PROFIL's, in
; a VM, and so is profile_select's call of prof_fx_drop, which is tested here on its own.
; SPDX-License-Identifier: MIT

        cpu     8086
        org     100h

        jmp     start

%include "startup/patch.asm"
%include "startup/files.asm"
%include "engine/rules.asm"             ; step_at, and the table's layout
%include "startup/profile.asm"
%include "testlib.inc"

; What profile.asm and rules.asm use of the rest of ReBeep, as stand-ins.
OPT_P           equ     0002h
opl_set_voice:
print:
print_not_used:
        ret
msg_pn_3        db      '$'
fail_spec       dw      0
patch_ok        db      0
opt_set         dw      0
RB_STATE        times RBS_REC4 + 22 db 0

; ---------------------------------------------------------------- helpers

; TEXT label, bytes: the bytes as data, and label_len as their length.
%macro TEXT 2+
%1:     db      %2
%1_len  equ     $ - %1
%endmacro

cf_ax:
        mov     ax, 0
        adc     ax, 0
        ret

; reason_ok: Out: AX = 0 when SI points at a reason: a '$'-terminated string of 1 to 80 characters.
reason_ok:
        mov     cx, 81
        cmp     si, patch_parse
        jb      .bad
.next:
        cmp     byte [si], '$'
        je      .end
        inc     si
        loop    .next
        jmp     .bad
.end:
        cmp     cx, 81
        jae     .bad
        xor     ax, ax
        ret
.bad:
        mov     ax, 1
        ret

; streq: SI, DI = ASCIZ strings. Out: AX = 0 when equal.
streq:
        push    si
        push    di
.next:
        mov     al, [si]
        cmp     al, [di]
        jne     .no
        or      al, al
        jz      .yes
        inc     si
        inc     di
        jmp     .next
.yes:
        xor     ax, ax
        jmp     .out
.no:
        mov     ax, 1
.out:
        pop     di
        pop     si
        ret

; parse: SI = text, CX = its length. Out: CF as profile_parse; AX = CF.
%macro PARSE 1
        mov     si, %1
        mov     cx, %1_len
        call    profile_parse
%endmacro

; GOOD text: it parses.
%macro GOOD 1
        PARSE   %1
        call    cf_ax
        xor     cx, cx
        call    t_check
%endmacro

; BAD text, reason: it is refused, with that reason.
%macro BAD 2
        PARSE   %1
        mov     [got_si], si
        call    cf_ax
        mov     cx, 1
        call    t_check
        mov     ax, [got_si]
        mov     cx, %2
        call    t_check
        mov     si, [got_si]
        call    reason_ok
        xor     cx, cx
        call    t_check
%endmacro

; BYTE_IS address, value / WORD_IS address, value
%macro BYTE_IS 2
        mov     al, [%1]
        xor     ah, ah
        mov     cx, %2
        call    t_check
%endmacro
%macro WORD_IS 2
        mov     ax, [%1]
        mov     cx, %2
        call    t_check
%endmacro

; STEP_IS rule, step, kind, lo, hi: one step of prof_new as the parse left it.
%define STEPADDR(r, s) prof_new + PT_RULES + (r) * RULE_LEN + RL_STEP + (s) * STEP_LEN
%macro STEP_IS 5
        BYTE_IS STEPADDR(%1, %2) + ST_KIND, %3
        WORD_IS STEPADDR(%1, %2) + ST_LO, %4
        WORD_IS STEPADDR(%1, %2) + ST_HI, %5
%endmacro
; RULE_IS rule, steps, slot, flags
%define RULEADDR(r) prof_new + PT_RULES + (r) * RULE_LEN
%macro RULE_IS 4
        BYTE_IS RULEADDR(%1) + RL_STEPS, %2
        BYTE_IS RULEADDR(%1) + RL_SLOT, %3
        BYTE_IS RULEADDR(%1) + RL_FLAGS, %4
        BYTE_IS RULEADDR(%1) + RL_AT, 0
%endmacro
; EFFECT_IS effect, lowest, highest, slot, while
%define EFFECTADDR(f) prof_new + PT_EFFECTS + (f) * EFFECT_LEN
%macro EFFECT_IS 5
        WORD_IS EFFECTADDR(%1) + EF_LO, %2
        WORD_IS EFFECTADDR(%1) + EF_HI, %3
        BYTE_IS EFFECTADDR(%1) + EF_SLOT, %4
        BYTE_IS EFFECTADDR(%1) + EF_WHILE, %5
%endmacro
; LOADED slot: the slot's patch counts as loaded, as prof_load_slot leaves it.
%macro LOADED 1
        mov     byte [prof_new + PT_BLOCKS + (%1) * PBLK_LEN + PB_FLAGS], RBS_PF_LOADED
%endmacro
; SAVE_TABLE / TABLE_IS_SAVED: prof_new, as a parse left it, kept and compared with a later one.
%macro SAVE_TABLE 0
        mov     si, prof_new
        mov     di, saved_table
        mov     cx, PT_LEN
        rep     movsb
%endmacro
%macro TABLE_IS_SAVED 0
        mov     si, prof_new
        mov     di, saved_table
        mov     cx, PT_LEN
        repe    cmpsb
        mov     ax, 0
        je      %%same
        inc     ax
%%same:
        xor     cx, cx
        call    t_check
%endmacro
; NAME_IS slot, "NAME"
%macro NAME_IS 2
        mov     si, prof_names + (%1) * PROF_NAME_LEN
        mov     di, %%name
        call    streq
        xor     cx, cx
        call    t_check
        jmp     %%over
%%name: db      %2, 0
%%over:
%endmacro

; WORD_OK text, value / WORD_NO text: get_word on a span.
%macro WORD_OK 2
        mov     si, %%t
        mov     dx, %%e
        call    get_word
        mov     [got_ax], ax
        call    cf_ax
        xor     cx, cx
        call    t_check
        mov     ax, [got_ax]
        mov     cx, %2
        call    t_check
        jmp     %%over
%%t:    db      %1
%%e:
%%over:
%endmacro
%macro WORD_NO 1
        mov     si, %%t
        mov     dx, %%e
        call    get_word
        call    cf_ax
        mov     cx, 1
        call    t_check
        jmp     %%over
%%t:    db      %1
%%e:
%%over:
%endmacro

; ---------------------------------------------------------------- texts

%define HEAD    "[PROFILE]", 10, "FORMAT=1", 10

TEXT p_gpc, "[PROFILE]", 13, 10, "FORMAT=1", 13, 10, "DEFAULT=FALLBK", 13, 10, 13, 10, \
        "[RULE]", 13, 10, "STEP=CTRL B6h", 13, 10, "STEP=NOTE 1922h 40", 13, 10, "PATCH=INTRO", 13, 10, \
        "[RULE]", 13, 10, "STEP=CTRL B6h", 13, 10, "STEP=NOTE 1521h 40", 13, 10, "PATCH=MENU", 13, 10, \
        "[RULE]", 13, 10, "STEP=CTRL B6h", 13, 10, "STEP=NOTE", 13, 10, "PATCH=FALLBK", 13, 10

; Decimal, padding, tabs, lower case, comments, unknown keys and sections, no final line end.
TEXT p_messy, "; a profile", 10, "IGNORED=1", 10, "  [ profile ]  ", 10, 9, "format", 9, "=", 9, "1 ", 10, \
        "Name=ignored", 10, "[Other]", 10, "FORMAT=9", 10, "STEP=junk", 10, \
        "[rule]", 10, " step = note 6434 40 ", 10, "Comment=x", 10, "patch = intro", 10, \
        "[RULE]", 10, "STEP=change 0Ah", 10, "STEP=Ctrl", 10, "STEP=off", 10, "STEP=NOTE 0", 10, "PATCH=Intro"

; The ends of the numbers: a tolerance cut at 0 and at FFFFh, CTRL's largest byte.
TEXT p_ends, HEAD, "[RULE]", 10, "STEP=NOTE 10 40", 10, "STEP=CHANGE 0FFF0h 40", 10, "STEP=CTRL 255", 10, \
        "STEP=NOTE 65535 65535", 10, "PATCH=A", 10

; Rules only, no DEFAULT; a DEFAULT alone; no rules at all.
TEXT p_nodefault, HEAD, "[RULE]", 10, "STEP=OFF", 10, "PATCH=ONE", 10
TEXT p_default, HEAD, "DEFAULT=ORGAN", 10
TEXT p_defaultlast, "[RULE]", 10, "STEP=OFF", 10, "PATCH=ONE", 10, HEAD, "DEFAULT=TWO", 10

; The limits: 16 rules, 4 steps, 8 patches, 2048 bytes.
%macro RULES 1
%assign %%i 0
%rep %1
        db      "[RULE]", 10, "STEP=OFF", 10, "PATCH=P", '0' + (%%i % 8), 10
%assign %%i %%i + 1
%endrep
%endmacro
p_16rules:
        db      HEAD
        RULES   16
p_16rules_len equ $ - p_16rules
p_17rules:
        db      HEAD
        RULES   17
p_17rules_len equ $ - p_17rules

TEXT p_4steps, HEAD, "[RULE]", 10, "STEP=OFF", 10, "STEP=OFF", 10, "STEP=OFF", 10, "STEP=OFF", 10, "PATCH=A", 10
TEXT p_5steps, HEAD, "[RULE]", 10, "STEP=OFF", 10, "STEP=OFF", 10, "STEP=OFF", 10, "STEP=OFF", 10, \
        "STEP=OFF", 10, "PATCH=A", 10

%macro PATCHES 1
%assign %%i 0
%rep %1
        db      "[RULE]", 10, "STEP=OFF", 10, "PATCH=Q", 'A' + %%i, 10
%assign %%i %%i + 1
%endrep
%endmacro
p_8patches:
        db      HEAD
        PATCHES 7
        db      "DEFAULT=QH", 10        ; in [RULE]: ignored there
        db      "[PROFILE]", 10
p_8patches_bad_len equ $ - p_8patches   ; a second [PROFILE]
p_8patch2:
        db      "[PROFILE]", 10, "FORMAT=1", 10, "DEFAULT=QH", 10
        PATCHES 8
p_8patch2_len equ $ - p_8patch2
p_9patches:
        db      "[PROFILE]", 10, "FORMAT=1", 10, "DEFAULT=QI", 10
        PATCHES 8
p_9patches_len equ $ - p_9patches

p_2048:
        db      HEAD, ";"
        times 2048 - ($ - p_2048) db 'x'
p_2048_len equ 2048
p_2049:
        db      HEAD, ";"
        times 2049 - ($ - p_2049) db 'x'
p_2049_len equ 2049

; Every new key: two rules and an effect, with their IDs, names and a WHILE; and the same without
; the NAME lines, whose table must come out identical.
TEXT p_fx, "[PROFILE]", 13, 10, "FORMAT=1", 13, 10, "NAME=Grand Prix Circuit", 13, 10, \
        "DEFAULT=FALLBK", 13, 10, 13, 10, \
        "[RULE]", 13, 10, "ID=GRID", 13, 10, "NAME=Race start", 13, 10, "STEP=CTRL B6h", 13, 10, \
        "STEP=NOTE C22Eh 40", 13, 10, "PATCH=ENGINE", 13, 10, 13, 10, \
        "[RULE]", 13, 10, "ID=RACE", 13, 10, "NAME=Racing", 13, 10, "WHILE=GRID", 13, 10, \
        "STEP=PITCH 0471h 30", 13, 10, "STEP=OFF", 13, 10, "PATCH=ENGINE", 13, 10, 13, 10, \
        "[EFFECT]", 13, 10, "NAME=Start lights", 13, 10, "WHILE=GRID", 13, 10, \
        "PITCH=11D6h 40", 13, 10, "PATCH=LIGHTS", 13, 10
TEXT p_fxbare, "[PROFILE]", 13, 10, "FORMAT=1", 13, 10, \
        "DEFAULT=FALLBK", 13, 10, 13, 10, \
        "[RULE]", 13, 10, "ID=GRID", 13, 10, "STEP=CTRL B6h", 13, 10, \
        "STEP=NOTE C22Eh 40", 13, 10, "PATCH=ENGINE", 13, 10, 13, 10, \
        "[RULE]", 13, 10, "ID=RACE", 13, 10, "WHILE=GRID", 13, 10, \
        "STEP=PITCH 0471h 30", 13, 10, "STEP=OFF", 13, 10, "PATCH=ENGINE", 13, 10, 13, 10, \
        "[EFFECT]", 13, 10, "WHILE=GRID", 13, 10, \
        "PITCH=11D6h 40", 13, 10, "PATCH=LIGHTS", 13, 10

; A WHILE naming a later rule (rule 0 names rule 2), itself (rule 1), and a later rule from an
; effect before it, in any case; the later rule's ID is eight characters.
TEXT p_whiles, HEAD, \
        "[RULE]", 10, "ID=A", 10, "WHILE=ABCDEFGH", 10, "STEP=OFF", 10, "PATCH=P", 10, \
        "[RULE]", 10, "ID=B", 10, "WHILE=b", 10, "STEP=NOTE", 10, "PATCH=P", 10, \
        "[EFFECT]", 10, "WHILE=abcdefgh", 10, "PITCH=500", 10, "PATCH=P", 10, \
        "[RULE]", 10, "ID=abcdefgh", 10, "STEP=OFF", 10, "PATCH=P", 10

; Sixteen IDs, and a WHILE on the last rule: (15 + 1) * 2 is the largest value.
%macro IDRULES 1
%assign %%i 0
%rep %1
        db      "[RULE]", 10, "ID=Q", 'A' + %%i, 10, "STEP=OFF", 10, "PATCH=P", 10
%assign %%i %%i + 1
%endrep
%endmacro
p_16ids:
        db      HEAD
        IDRULES 16
        db      "[EFFECT]", 10, "WHILE=qp", 10, "PITCH=500", 10, "PATCH=P", 10
p_16ids_len equ $ - p_16ids

; NAME: 24 characters at the longest, trimmed first, bytes from 20h to 7Eh and from 80h up.
%define N24     "ABCDEFGHIJKLMNOPQRSTUVWX"
%define N25     "ABCDEFGHIJKLMNOPQRSTUVWXY"
TEXT p_name24, HEAD, "NAME=", N24, 10, \
        "[RULE]", 10, "NAME=", N24, 10, "STEP=OFF", 10, "PATCH=A", 10, \
        "[EFFECT]", 10, "NAME=", N24, 10, "PITCH=500", 10, "PATCH=A", 10
TEXT p_namepad, HEAD, "[RULE]", 10, "NAME=", 9, "  ", N24, "  ", 9, 13, 10, "STEP=OFF", 10, "PATCH=A", 10, \
        "[EFFECT]", 10, "NAME=Caf", 82h, " ~ ", 0FFh, 10, "PITCH=500", 10, "PATCH=A", 10

; Effects: the limit of 8, each with a patch of its own (and 8 patches in all); one that shares
; its rule's patch; the forms a PITCH takes.
%macro EFFECTS 1
%assign %%i 0
%rep %1
        db      "[EFFECT]", 10, "PITCH=500", 10, "PATCH=F", 'A' + %%i, 10
%assign %%i %%i + 1
%endrep
%endmacro
p_8fx:
        db      HEAD
        EFFECTS 8
p_8fx_len equ $ - p_8fx
p_9fx:
        db      HEAD
        EFFECTS 9
p_9fx_len equ $ - p_9fx
TEXT p_fxsame, HEAD, "[RULE]", 10, "STEP=OFF", 10, "PATCH=A", 10, \
        "[EFFECT]", 10, "PITCH=500", 10, "PATCH=a", 10
TEXT p_pitches, HEAD, "[EFFECT]", 10, "PITCH=193", 10, "PATCH=A", 10, \
        "[EFFECT]", 10, "PITCH=200 7", 10, "PATCH=A", 10, \
        "[EFFECT]", 10, "PITCH=65535 100", 10, "PATCH=A", 10, \
        "[EFFECT]", 10, "  pitch = 1000h  ", 10, "patch = a", 10

; Four effects on three patches: A, B, C, and B again.
TEXT p_fxdrop, HEAD, "[EFFECT]", 10, "PITCH=500", 10, "PATCH=A", 10, \
        "[EFFECT]", 10, "PITCH=600", 10, "PATCH=B", 10, \
        "[EFFECT]", 10, "PITCH=700", 10, "PATCH=C", 10, \
        "[EFFECT]", 10, "PITCH=800", 10, "PATCH=B", 10

; OFF never has a value, so it is no catch-all; NOTE, CHANGE, PITCH and CTRL without one are.
TEXT p_anyflags, HEAD, \
        "[RULE]", 10, "STEP=OFF", 10, "STEP=NOTE", 10, "PATCH=A", 10, \
        "[RULE]", 10, "STEP=NOTE", 10, "STEP=OFF", 10, "PATCH=A", 10, \
        "[RULE]", 10, "STEP=CHANGE", 10, "PATCH=A", 10, \
        "[RULE]", 10, "STEP=CTRL", 10, "PATCH=A", 10, \
        "[RULE]", 10, "STEP=off", 10, "PATCH=A", 10, \
        "[RULE]", 10, "STEP=OFF", 10, "STEP=NOTE 200", 10, "STEP=CTRL", 10, "STEP=OFF", 10, "PATCH=A", 10, \
        "[RULE]", 10, "STEP=pitch", 10, "PATCH=A", 10

; Texts the parser must refuse, with the reason each must give.
TEXT b_noprofile, "[RULE]", 10, "STEP=OFF", 10, "PATCH=A", 10
TEXT b_noformat, "[PROFILE]", 10, "DEFAULT=A", 10
TEXT b_format2, "[PROFILE]", 10, "FORMAT=2", 10
TEXT b_formatx, "[PROFILE]", 10, "FORMAT=1h", 10
TEXT b_formatdup, HEAD, "format=1", 10
TEXT b_defaultdup, HEAD, "DEFAULT=A", 10, "DEFAULT=A", 10
TEXT b_profiledup, HEAD, "[profile]", 10
TEXT b_header, "[PROFILE", 10, "FORMAT=1", 10
TEXT b_nostep, HEAD, "[RULE]", 10, "PATCH=A", 10
TEXT b_nostepend, HEAD, "[RULE]", 10, "PATCH=A", 10, "[OTHER]", 10
TEXT b_nopatch, HEAD, "[RULE]", 10, "STEP=OFF", 10
TEXT b_nopatchnext, HEAD, "[RULE]", 10, "STEP=OFF", 10, "[RULE]", 10, "STEP=OFF", 10, "PATCH=A", 10
TEXT b_patchdup, HEAD, "[RULE]", 10, "STEP=OFF", 10, "PATCH=A", 10, "PATCH=A", 10
TEXT b_kind, HEAD, "[RULE]", 10, "STEP=BEEP 100", 10, "PATCH=A", 10
TEXT b_empty, HEAD, "[RULE]", 10, "STEP=", 10, "PATCH=A", 10
TEXT b_offvalue, HEAD, "[RULE]", 10, "STEP=OFF 1", 10, "PATCH=A", 10
TEXT b_ctrlbig, HEAD, "[RULE]", 10, "STEP=CTRL 100h", 10, "PATCH=A", 10
TEXT b_ctrltol, HEAD, "[RULE]", 10, "STEP=CTRL B6h 1", 10, "PATCH=A", 10
TEXT b_fourth, HEAD, "[RULE]", 10, "STEP=NOTE 1 2 3", 10, "PATCH=A", 10
TEXT b_number, HEAD, "[RULE]", 10, "STEP=NOTE 12x", 10, "PATCH=A", 10
TEXT b_big, HEAD, "[RULE]", 10, "STEP=NOTE 65536", 10, "PATCH=A", 10
TEXT b_bighex, HEAD, "[RULE]", 10, "STEP=NOTE 10000h", 10, "PATCH=A", 10
TEXT b_tol, HEAD, "[RULE]", 10, "STEP=NOTE 100 -1", 10, "PATCH=A", 10
TEXT b_folder, HEAD, "[RULE]", 10, "STEP=OFF", 10, "PATCH=GPC\A", 10
TEXT b_long, HEAD, "[RULE]", 10, "STEP=OFF", 10, "PATCH=ABCDEFGHI", 10
TEXT b_digits, HEAD, "[RULE]", 10, "STEP=OFF", 10, "PATCH=123", 10
TEXT b_nopatchname, HEAD, "[RULE]", 10, "STEP=OFF", 10, "PATCH=", 10
TEXT b_baddefault, HEAD, "DEFAULT=A.RBP", 10

; An effect with its PITCH as given, and a patch.
%macro PITCH_TEXT 2
TEXT %1, HEAD, "[EFFECT]", 10, "PITCH=", %2, 10, "PATCH=A", 10
%endmacro
; A rule with its ID and WHILE as given, and a step and patch; and a second rule, ID=GRID.
%macro WHILE_TEXT 2+
TEXT %1, HEAD, "[RULE]", 10, "ID=GRID", 10, "STEP=OFF", 10, "PATCH=A", 10, \
        "[RULE]", 10, %2, 10, "STEP=OFF", 10, "PATCH=A", 10
%endmacro

PITCH_TEXT b_pitchlow, "192"
PITCH_TEXT b_pitchzero, "0"
PITCH_TEXT b_pitchwide, "200 10"
PITCH_TEXT b_pitchwider, "100 100"
PITCH_TEXT b_pitchjunk, "12x"
PITCH_TEXT b_pitchempty, ""
PITCH_TEXT b_pitchthird, "500 1 2"
PITCH_TEXT b_pitchbig, "65536"
PITCH_TEXT b_pitchtol, "500 -1"
TEXT b_nopitch, HEAD, "[EFFECT]", 10, "PATCH=A", 10, "[RULE]", 10, "STEP=OFF", 10, "PATCH=A", 10
TEXT b_nopitchend, HEAD, "[EFFECT]", 10, "PATCH=A", 10
TEXT b_nofxpatch, HEAD, "[EFFECT]", 10, "PITCH=500", 10
TEXT b_nofxpatchnext, HEAD, "[EFFECT]", 10, "PITCH=500", 10, "[EFFECT]", 10, "PITCH=500", 10, "PATCH=A", 10
TEXT b_pitchdup, HEAD, "[EFFECT]", 10, "PITCH=500", 10, "pitch=500", 10, "PATCH=A", 10
TEXT b_fxpatchdup, HEAD, "[EFFECT]", 10, "PITCH=500", 10, "PATCH=A", 10, "PATCH=B", 10
TEXT b_fxwhiledup, HEAD, "[RULE]", 10, "ID=A", 10, "STEP=OFF", 10, "PATCH=A", 10, \
        "[EFFECT]", 10, "WHILE=A", 10, "WHILE=A", 10, "PITCH=500", 10, "PATCH=A", 10
TEXT b_fxpatchnone, HEAD, "[EFFECT]", 10, "PITCH=500", 10, "PATCH=", 10

TEXT b_idnumbers, HEAD, "[RULE]", 10, "ID=123", 10, "STEP=OFF", 10, "PATCH=A", 10
TEXT b_idlong, HEAD, "[RULE]", 10, "ID=ABCDEFGHI", 10, "STEP=OFF", 10, "PATCH=A", 10
TEXT b_idempty, HEAD, "[RULE]", 10, "ID=", 10, "STEP=OFF", 10, "PATCH=A", 10
TEXT b_idchar, HEAD, "[RULE]", 10, "ID=A.B", 10, "STEP=OFF", 10, "PATCH=A", 10
TEXT b_idfolder, HEAD, "[RULE]", 10, "ID=A\B", 10, "STEP=OFF", 10, "PATCH=A", 10
TEXT b_iddup, HEAD, "[RULE]", 10, "ID=Grid", 10, "STEP=OFF", 10, "PATCH=A", 10, \
        "[RULE]", 10, "ID=B", 10, "STEP=OFF", 10, "PATCH=A", 10, \
        "[RULE]", 10, "ID=GRID", 10, "STEP=OFF", 10, "PATCH=A", 10
TEXT b_idtwice, HEAD, "[RULE]", 10, "ID=A", 10, "ID=B", 10, "STEP=OFF", 10, "PATCH=A", 10

WHILE_TEXT b_whileno, "WHILE=RACE"
WHILE_TEXT b_whileprefix, "WHILE=GRI"
WHILE_TEXT b_whilelonger, "WHILE=GRIDS"
WHILE_TEXT b_whileempty, "WHILE="
WHILE_TEXT b_whileblank, "WHILE=GRID RACE"
WHILE_TEXT b_whiletwice, "WHILE=GRID", 10, "WHILE=GRID"
TEXT b_whilenoid, HEAD, "[RULE]", 10, "STEP=OFF", 10, "WHILE=", 10, "PATCH=A", 10
TEXT b_fxwhileno, HEAD, "[RULE]", 10, "ID=GRID", 10, "STEP=OFF", 10, "PATCH=A", 10, \
        "[EFFECT]", 10, "WHILE=GRIDS", 10, "PITCH=500", 10, "PATCH=A", 10
TEXT b_whilestale, HEAD, "[RULE]", 10, "WHILE=A", 10, "STEP=OFF", 10, "PATCH=A", 10

TEXT b_name25, HEAD, "NAME=", N25, 10
TEXT b_name25rule, HEAD, "[RULE]", 10, "NAME=", N25, 10, "STEP=OFF", 10, "PATCH=A", 10
TEXT b_name25fx, HEAD, "[EFFECT]", 10, "NAME=", N25, 10, "PITCH=500", 10, "PATCH=A", 10
TEXT b_nameempty, HEAD, "NAME=", 10
TEXT b_nameblank, HEAD, "[RULE]", 10, "NAME=  ", 9, 10, "STEP=OFF", 10, "PATCH=A", 10
TEXT b_nametab, HEAD, "[RULE]", 10, "NAME=Race", 9, "start", 10, "STEP=OFF", 10, "PATCH=A", 10
TEXT b_name1f, HEAD, "NAME=Race", 1Fh, "start", 10
TEXT b_namedel, HEAD, "[EFFECT]", 10, "NAME=Race", 7Fh, "start", 10, "PITCH=500", 10, "PATCH=A", 10
TEXT b_nameprofdup, HEAD, "NAME=A", 10, "NAME=B", 10
TEXT b_nameruledup, HEAD, "[RULE]", 10, "NAME=A", 10, "STEP=OFF", 10, "name=B", 10, "PATCH=A", 10
TEXT b_namefxdup, HEAD, "[EFFECT]", 10, "NAME=A", 10, "PITCH=500", 10, "NAME=B", 10, "PATCH=A", 10

; 8 rules with a patch each, then an effect with a ninth; 8 effects with one each, then a rule.
p_fxshare:
        db      HEAD
        PATCHES 8
        db      "[EFFECT]", 10, "PITCH=500", 10, "PATCH=ZZ", 10
p_fxshare_len equ $ - p_fxshare
p_fxfull:
        db      HEAD
        EFFECTS 8
        db      "[RULE]", 10, "STEP=OFF", 10, "PATCH=ZZ", 10
p_fxfull_len equ $ - p_fxfull

bad_table:
        dw      b_noprofile, b_noprofile_len, g_noprofile
        dw      b_noformat, b_noformat_len, g_noformat
        dw      b_format2, b_format2_len, r_format
        dw      b_formatx, b_formatx_len, r_format
        dw      b_formatdup, b_formatdup_len, r_keydup
        dw      b_defaultdup, b_defaultdup_len, r_keydup
        dw      b_profiledup, b_profiledup_len, r_secdup
        dw      b_header, b_header_len, r_header
        dw      b_nostep, b_nostep_len, g_nostep
        dw      b_nostepend, b_nostepend_len, g_nostep
        dw      b_nopatch, b_nopatch_len, g_nopatch
        dw      b_nopatchnext, b_nopatchnext_len, g_nopatch
        dw      b_patchdup, b_patchdup_len, r_keydup
        dw      b_kind, b_kind_len, g_step
        dw      b_empty, b_empty_len, g_step
        dw      b_offvalue, b_offvalue_len, g_step
        dw      b_ctrlbig, b_ctrlbig_len, g_step
        dw      b_ctrltol, b_ctrltol_len, g_step
        dw      b_fourth, b_fourth_len, g_step
        dw      b_number, b_number_len, g_step
        dw      b_big, b_big_len, g_step
        dw      b_bighex, b_bighex_len, g_step
        dw      b_tol, b_tol_len, g_step
        dw      b_folder, b_folder_len, g_name
        dw      b_long, b_long_len, g_name
        dw      b_digits, b_digits_len, g_name
        dw      b_nopatchname, b_nopatchname_len, g_name
        dw      b_baddefault, b_baddefault_len, g_name
        dw      p_17rules, p_17rules_len, g_rules
        dw      p_5steps, p_5steps_len, g_steps
        dw      p_9patches, p_9patches_len, g_patches
        dw      p_8patches, p_8patches_bad_len, r_secdup
        dw      p_2049, p_2049_len, r_size
        dw      p_9fx, p_9fx_len, g_effects
        dw      p_fxshare, p_fxshare_len, g_patches
        dw      p_fxfull, p_fxfull_len, g_patches
        dw      b_nopitch, b_nopitch_len, g_nopitch
        dw      b_nopitchend, b_nopitchend_len, g_nopitch
        dw      b_nofxpatch, b_nofxpatch_len, g_nofxpatch
        dw      b_nofxpatchnext, b_nofxpatchnext_len, g_nofxpatch
        dw      b_pitchlow, b_pitchlow_len, g_pitch
        dw      b_pitchzero, b_pitchzero_len, g_pitch
        dw      b_pitchwide, b_pitchwide_len, g_pitch
        dw      b_pitchwider, b_pitchwider_len, g_pitch
        dw      b_pitchjunk, b_pitchjunk_len, g_pitch
        dw      b_pitchempty, b_pitchempty_len, g_pitch
        dw      b_pitchthird, b_pitchthird_len, g_pitch
        dw      b_pitchbig, b_pitchbig_len, g_pitch
        dw      b_pitchtol, b_pitchtol_len, g_pitch
        dw      b_pitchdup, b_pitchdup_len, r_keydup
        dw      b_fxpatchdup, b_fxpatchdup_len, r_keydup
        dw      b_fxwhiledup, b_fxwhiledup_len, r_keydup
        dw      b_fxpatchnone, b_fxpatchnone_len, g_name
        dw      b_idnumbers, b_idnumbers_len, g_id
        dw      b_idlong, b_idlong_len, g_id
        dw      b_idempty, b_idempty_len, g_id
        dw      b_idchar, b_idchar_len, g_id
        dw      b_idfolder, b_idfolder_len, g_id
        dw      b_iddup, b_iddup_len, g_iddup
        dw      b_idtwice, b_idtwice_len, r_keydup
        dw      b_whileno, b_whileno_len, g_while
        dw      b_whileprefix, b_whileprefix_len, g_while
        dw      b_whilelonger, b_whilelonger_len, g_while
        dw      b_whileempty, b_whileempty_len, g_while
        dw      b_whileblank, b_whileblank_len, g_while
        dw      b_whiletwice, b_whiletwice_len, r_keydup
        dw      b_whilenoid, b_whilenoid_len, g_while
        dw      b_fxwhileno, b_fxwhileno_len, g_while
        dw      b_name25, b_name25_len, g_dispname
        dw      b_name25rule, b_name25rule_len, g_dispname
        dw      b_name25fx, b_name25fx_len, g_dispname
        dw      b_nameempty, b_nameempty_len, g_dispname
        dw      b_nameblank, b_nameblank_len, g_dispname
        dw      b_nametab, b_nametab_len, g_dispname
        dw      b_name1f, b_name1f_len, g_dispname
        dw      b_namedel, b_namedel_len, g_dispname
        dw      b_nameprofdup, b_nameprofdup_len, r_keydup
        dw      b_nameruledup, b_nameruledup_len, r_keydup
        dw      b_namefxdup, b_namefxdup_len, r_keydup
bad_end:

; ---------------------------------------------------------------- the cases

start:
        CASE    "parses_the_gpc_profile"
        GOOD    p_gpc
        BYTE_IS prof_new + PT_LAYOUT, PROF_LAYOUT
        BYTE_IS prof_new + PT_ACTIVE, 1
        BYTE_IS prof_new + PT_CUR, PT_NONE
        BYTE_IS prof_new + PT_COUNT, 3
        BYTE_IS prof_new + PT_STATE, 0
        BYTE_IS prof_new + PT_FXCOUNT, 0
        BYTE_IS prof_new + PT_FXSLOT, PT_NONE
        BYTE_IS prof_npat, 3            ; FALLBK, named twice, has one slot
        BYTE_IS prof_default, 0
        NAME_IS 0, "FALLBK"
        NAME_IS 1, "INTRO"
        NAME_IS 2, "MENU"
        RULE_IS 0, 2, 1, 0
        STEP_IS 0, 0, SK_CTRL, 0B6h, 0B6h
        STEP_IS 0, 1, SK_NOTE, 1922h - 40, 1922h + 40
        RULE_IS 1, 2, 2, 0
        STEP_IS 1, 1, SK_NOTE, 1521h - 40, 1521h + 40
        RULE_IS 2, 2, 0, RL_F_ANY
        STEP_IS 2, 1, SK_NOTE | SK_ANY, 0, 0FFFFh
        ENDCASE

        CASE    "parses_decimal_lowercase_padding_and_ignores_the_rest"
        GOOD    p_messy
        BYTE_IS prof_new + PT_COUNT, 2
        BYTE_IS prof_npat, 1
        BYTE_IS prof_default, PT_NONE
        NAME_IS 0, "INTRO"
        RULE_IS 0, 1, 0, 0
        STEP_IS 0, 0, SK_NOTE, 6434 - 40, 6434 + 40
        RULE_IS 1, 4, 0, 0              ; the last step has a value: no catch-all
        STEP_IS 1, 0, SK_CHANGE, 0Ah, 0Ah
        STEP_IS 1, 1, SK_CTRL | SK_ANY, 0, 0FFFFh
        STEP_IS 1, 2, SK_OFF | SK_ANY, 0, 0FFFFh
        STEP_IS 1, 3, SK_NOTE, 0, 0
        ENDCASE

        CASE    "tolerance_stops_at_the_ends"
        GOOD    p_ends
        STEP_IS 0, 0, SK_NOTE, 0, 50
        STEP_IS 0, 1, SK_CHANGE, 0FFF0h - 40, 0FFFFh
        STEP_IS 0, 2, SK_CTRL, 255, 255
        STEP_IS 0, 3, SK_NOTE, 0, 0FFFFh
        ENDCASE

        CASE    "default_is_optional_and_takes_a_slot"
        GOOD    p_nodefault
        BYTE_IS prof_default, PT_NONE
        BYTE_IS prof_npat, 1
        RULE_IS 0, 1, 0, 0              ; OFF takes no value, and is no catch-all
        GOOD    p_default
        BYTE_IS prof_new + PT_COUNT, 0
        BYTE_IS prof_default, 0
        BYTE_IS prof_npat, 1
        NAME_IS 0, "ORGAN"
        GOOD    p_defaultlast
        BYTE_IS prof_default, 1
        NAME_IS 1, "TWO"
        ENDCASE

        CASE    "takes_each_limit"
        GOOD    p_16rules
        BYTE_IS prof_new + PT_COUNT, 16
        BYTE_IS prof_npat, 8
        RULE_IS 15, 1, 7, 0
        RULE_IS 8, 1, 0, 0              ; P0 again: its slot
        GOOD    p_4steps
        RULE_IS 0, 4, 0, 0
        GOOD    p_8patch2
        BYTE_IS prof_npat, 8
        BYTE_IS prof_default, 0
        NAME_IS 7, "QG"
        GOOD    p_2048
        ENDCASE

        CASE    "stores_ids_whiles_and_effects"
        GOOD    p_fx
        BYTE_IS prof_new + PT_COUNT, 2
        BYTE_IS prof_new + PT_FXCOUNT, 1
        BYTE_IS prof_new + PT_STATE, 0
        BYTE_IS prof_new + PT_FXSLOT, PT_NONE
        BYTE_IS prof_new + PT_NAME, 0   ; the profile's NAME= is not kept
        BYTE_IS prof_npat, 3
        BYTE_IS prof_default, 0
        NAME_IS 0, "FALLBK"
        NAME_IS 1, "ENGINE"
        NAME_IS 2, "LIGHTS"
        RULE_IS 0, 2, 1, 0              ; no WHILE: nothing in RL_FLAGS
        STEP_IS 0, 1, SK_NOTE, 0C22Eh - 40, 0C22Eh + 40
        RULE_IS 1, 2, 1, 2              ; WHILE=GRID: rule 0, so (0 + 1) * 2; OFF last: no RL_F_ANY
        STEP_IS 1, 0, SK_PITCH, 0471h - 30, 0471h + 30
        STEP_IS 1, 1, SK_OFF | SK_ANY, 0, 0FFFFh
        EFFECT_IS 0, 11D6h - 40, 11D6h + 40, 2, 2
        ENDCASE

        CASE    "a_name_is_checked_and_never_stored"
        GOOD    p_fx
        SAVE_TABLE
        GOOD    p_fxbare
        TABLE_IS_SAVED
        GOOD    p_name24                ; 24 characters, in all three sections
        GOOD    p_namepad               ; trimmed first; 20h to 7Eh and 80h up are all right
        BYTE_IS prof_new + PT_NAME, 0
        ENDCASE

        CASE    "a_while_names_a_later_rule_or_itself"
        GOOD    p_whiles
        BYTE_IS prof_new + PT_COUNT, 3
        RULE_IS 0, 1, 0, 6              ; rule 2: (2 + 1) * 2
        RULE_IS 1, 1, 0, RL_F_ANY | 4   ; itself, rule 1: (1 + 1) * 2, and a catch-all
        RULE_IS 2, 1, 0, 0
        EFFECT_IS 0, 500, 500, 0, 6     ; an effect before the rule it names, in other case
        GOOD    p_16ids
        BYTE_IS prof_new + PT_COUNT, 16
        EFFECT_IS 0, 500, 500, 0, 20h   ; rule 15: (15 + 1) * 2
        RULE_IS 15, 1, 0, 0
        ENDCASE

        CASE    "an_old_id_is_forgotten_by_the_next_file"
        GOOD    p_whiles
        BAD     b_whilestale, g_while   ; ID=A was rule 0's one parse ago
        ENDCASE

        CASE    "effects_take_their_limit_and_share_the_patches"
        GOOD    p_8fx
        BYTE_IS prof_new + PT_FXCOUNT, 8
        BYTE_IS prof_npat, 8
        EFFECT_IS 0, 500, 500, 0, 0
        EFFECT_IS 7, 500, 500, 7, 0
        NAME_IS 7, "FH"
        GOOD    p_fxsame
        BYTE_IS prof_npat, 1            ; the rule's patch, named again by the effect
        BYTE_IS prof_new + PT_COUNT, 1
        BYTE_IS prof_new + PT_FXCOUNT, 1
        EFFECT_IS 0, 500, 500, 0, 0
        ENDCASE

        CASE    "a_pitch_is_a_divisor_and_a_tolerance"
        GOOD    p_pitches
        BYTE_IS prof_new + PT_FXCOUNT, 4
        EFFECT_IS 0, 193, 193, 0, 0     ; DIV_MIN itself
        EFFECT_IS 1, 193, 207, 0, 0     ; 200 - 7: DIV_MIN
        EFFECT_IS 2, 65435, 0FFFFh, 0, 0
        EFFECT_IS 3, 1000h, 1000h, 0, 0
        ENDCASE

        CASE    "an_effect_whose_patch_did_not_load_is_dropped"
        GOOD    p_fxdrop
        LOADED  0
        LOADED  2
        call    prof_fx_drop            ; B failed: both effects on it go, the others keep their order
        BYTE_IS prof_new + PT_FXCOUNT, 2
        EFFECT_IS 0, 500, 500, 0, 0
        EFFECT_IS 1, 700, 700, 2, 0
        GOOD    p_fxdrop
        call    prof_fx_drop            ; none loaded
        BYTE_IS prof_new + PT_FXCOUNT, 0
        GOOD    p_fxdrop
        LOADED  0
        LOADED  1
        LOADED  2
        call    prof_fx_drop            ; all loaded
        BYTE_IS prof_new + PT_FXCOUNT, 4
        EFFECT_IS 3, 800, 800, 1, 0
        GOOD    p_nodefault
        call    prof_fx_drop            ; no effects
        BYTE_IS prof_new + PT_FXCOUNT, 0
        ENDCASE

        CASE    "off_is_no_catch_all_but_the_other_kinds_are"
        GOOD    p_anyflags
        RULE_IS 0, 2, 0, RL_F_ANY       ; OFF, then NOTE
        RULE_IS 1, 2, 0, 0              ; NOTE, then OFF
        STEP_IS 1, 0, SK_NOTE | SK_ANY, 0, 0FFFFh
        STEP_IS 1, 1, SK_OFF | SK_ANY, 0, 0FFFFh        ; it still matches any note stop
        RULE_IS 2, 1, 0, RL_F_ANY       ; CHANGE
        RULE_IS 3, 1, 0, RL_F_ANY       ; CTRL
        RULE_IS 4, 1, 0, 0              ; OFF alone
        RULE_IS 5, 4, 0, 0              ; the last step is OFF; an earlier CTRL took any
        STEP_IS 5, 2, SK_CTRL | SK_ANY, 0, 0FFFFh
        RULE_IS 6, 1, 0, RL_F_ANY       ; PITCH: a note start or a change, any value
        STEP_IS 6, 0, SK_PITCH | SK_ANY, 0, 0FFFFh
        ENDCASE

        CASE    "a_refused_file_gives_its_reason"
        mov     word [tw], bad_table
.next:
        mov     bx, [tw]
        mov     si, [bx]
        mov     cx, [bx + 2]
        call    profile_parse
        mov     [got_si], si
        call    cf_ax
        mov     cx, 1
        call    t_check
        mov     bx, [tw]
        mov     ax, [got_si]
        mov     cx, [bx + 4]
        mov     bx, [bx]                ; the text, shown on a failure
        call    t_check
        mov     si, [got_si]
        call    reason_ok
        xor     cx, cx
        call    t_check
        add     word [tw], 6
        cmp     word [tw], bad_end
        jb      .next
        ENDCASE

        CASE    "numbers_decimal_and_hex"
        WORD_OK "0", 0
        WORD_OK "65535", 0FFFFh
        WORD_OK "6434", 1922h
        WORD_OK "1922h", 1922h
        WORD_OK "b6H", 0B6h
        WORD_OK "0FFFFh", 0FFFFh
        WORD_OK "00000000012", 12
        mov     si, n_gpc               ; an empty span
        mov     dx, n_gpc
        call    get_word
        call    cf_ax
        mov     cx, 1
        call    t_check
        WORD_NO "h"
        WORD_NO "65536"
        WORD_NO "10000h"
        WORD_NO "1g"
        WORD_NO "12a"
        WORD_NO "-1"
        WORD_NO "1:"
        ENDCASE

        CASE    "profile_names"
        mov     si, n_gpc
        mov     cx, n_gpc_len
        call    name_valid
        call    cf_ax
        xor     cx, cx
        call    t_check
        mov     si, spec_buf
        mov     di, n_gpcup
        call    streq
        xor     cx, cx
        call    t_check
        mov     si, n_folder
        mov     cx, n_folder_len
        call    name_valid
        call    cf_ax
        mov     cx, 1
        call    t_check
        mov     si, n_digits
        mov     cx, n_digits_len
        call    name_valid
        call    cf_ax
        mov     cx, 1
        call    t_check
        ENDCASE

        jmp     t_done

TEXT    n_gpc, "gpc"
n_gpcup db      "GPC", 0
TEXT    n_folder, "GPC\X"
TEXT    n_digits, "1234"

tw              dw      0
got_si          dw      0
got_ax          dw      0
saved_table     times PT_LEN db 0
