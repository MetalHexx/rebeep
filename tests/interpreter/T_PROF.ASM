; T_PROF - the startup part's game profile parser (startup/profile.asm): a .RBG text into the rule
; table, its numbers and names, every reason a file is refused, and each limit. The parser runs
; on text buffers; loading the patches is P_PROFIL's, in a VM.
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
        "[RULE]", 10, "STEP=pitch 0Ah", 10, "STEP=Ctrl", 10, "STEP=off", 10, "STEP=NOTE 0", 10, "PATCH=Intro"

; The ends of the numbers: a tolerance cut at 0 and at FFFFh, CTRL's largest byte.
TEXT p_ends, HEAD, "[RULE]", 10, "STEP=NOTE 10 40", 10, "STEP=PITCH 0FFF0h 40", 10, "STEP=CTRL 255", 10, \
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
bad_end:

; ---------------------------------------------------------------- the cases

start:
        CASE    "parses_the_gpc_profile"
        GOOD    p_gpc
        BYTE_IS prof_new + PT_LAYOUT, PROF_LAYOUT
        BYTE_IS prof_new + PT_ACTIVE, 1
        BYTE_IS prof_new + PT_CUR, PT_NONE
        BYTE_IS prof_new + PT_COUNT, 3
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
        STEP_IS 1, 0, SK_PITCH, 0Ah, 0Ah
        STEP_IS 1, 1, SK_CTRL | SK_ANY, 0, 0FFFFh
        STEP_IS 1, 2, SK_OFF | SK_ANY, 0, 0FFFFh
        STEP_IS 1, 3, SK_NOTE, 0, 0
        ENDCASE

        CASE    "tolerance_stops_at_the_ends"
        GOOD    p_ends
        STEP_IS 0, 0, SK_NOTE, 0, 50
        STEP_IS 0, 1, SK_PITCH, 0FFF0h - 40, 0FFFFh
        STEP_IS 0, 2, SK_CTRL, 255, 255
        STEP_IS 0, 3, SK_NOTE, 0, 0FFFFh
        ENDCASE

        CASE    "default_is_optional_and_takes_a_slot"
        GOOD    p_nodefault
        BYTE_IS prof_default, PT_NONE
        BYTE_IS prof_npat, 1
        RULE_IS 0, 1, 0, RL_F_ANY       ; OFF takes no value: its rule is a catch-all
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
        RULE_IS 15, 1, 7, RL_F_ANY
        RULE_IS 8, 1, 0, RL_F_ANY       ; P0 again: its slot
        GOOD    p_4steps
        RULE_IS 0, 4, 0, RL_F_ANY
        GOOD    p_8patch2
        BYTE_IS prof_npat, 8
        BYTE_IS prof_default, 0
        NAME_IS 7, "QG"
        GOOD    p_2048
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
