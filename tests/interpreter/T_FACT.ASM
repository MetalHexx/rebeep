; T_FACT - the game profiles ReBeep comes with. Each folder in FACTORY\PROFILES\ beside it (the
; suite stages the factory files there) is loaded by profile_select (startup/profile.asm), the path
; /G: takes, and must be used with every patch it names. One PASS a profile; each failure names the
; profile, or the patch, and the reason. Finding no profile fails too.
; SPDX-License-Identifier: MIT

        cpu     8086
        org     100h

        jmp     start

%include "startup/patch.asm"
%include "startup/files.asm"
%include "engine/rules.asm"             ; step_at, and the table's layout
%include "startup/profile.asm"
%include "testlib.inc"

; What profile.asm and rules.asm use of the rest of ReBeep, as stand-ins. print drops ReBeep's
; messages: this program writes its own result lines.
OPT_P           equ     0002h
opl_set_voice:
print:
        ret
msg_pn_3        db      '$'
fail_spec       dw      0
patch_ok        db      0
opt_set         dw      0
RB_STATE        times RBS_REC4 + 22 db 0

; print_not_used: a patch did not load: a FAIL line naming it ("NAME\PATCH", fail_spec) and why.
print_not_used:
        mov     byte [patch_failed], 1
        mov     si, [fail_spec]
        jmp     fail_line

; fail_line: SI = ASCIZ, what failed. Writes "FAIL <it>: <fail_reason>".
fail_line:
        mov     dx, s_fail
        call    result_start
        mov     cx, 40
        call    print_text
        mov     dx, s_colon
        call    t_print
        mov     dx, [fail_reason]
        call    t_print
        mov     dx, s_crlf
        jmp     t_print

; result_start: DX = s_pass or s_fail. Starts a counted result line, on a line of its own: what
; print_text puts out for ReBeep's messages is no part of it. Keeps SI and CX.
result_start:
        push    dx
        mov     dx, s_crlf
        call    t_print
        pop     dx
        inc     word [t_count]
        jmp     t_print

; check_profile: loads the profile whose folder the search found, as /G: does, and reports it.
check_profile:
        inc     word [found]
        mov     si, dta + 1Eh           ; the folder's name
        call    asciz_len
        call    name_valid              ; the names /G: takes; into spec_buf
        jnc     .named
        mov     word [fail_reason], r_noname
        jmp     fail_line
.named:
        push    ds
        pop     es
        cld
        mov     si, spec_buf
        mov     di, prof_spec
        call    copy_upper
        mov     byte [patch_failed], 0
        mov     word [fail_reason], r_norbg     ; the one failure that sets no reason
        call    crit_on
        call    profile_select
        call    crit_off
        mov     si, prof_spec
        cmp     byte [prof_ok], 0
        je      fail_line
        cmp     byte [patch_failed], 0
        jne     .ret                    ; each such patch has its FAIL line
        mov     dx, s_pass
        call    result_start
        mov     cx, 8
        call    print_text
        mov     dx, s_crlf
        jmp     t_print
.ret:
        ret

start:
        call    find_prog_dir
        mov     dx, dta
        mov     ah, 1Ah
        int     21h
        mov     dx, s_search
        mov     cx, 10h                 ; folders too
        mov     ah, 4Eh
        int     21h
        jc      .searched
.entry:
        test    byte [dta + 15h], 10h   ; a folder, but not "." or ".."
        jz      .next
        cmp     byte [dta + 1Eh], '.'
        je      .next
        call    check_profile
.next:
        mov     ah, 4Fh
        int     21h
        jnc     .entry
.searched:
        cmp     word [found], 0
        jne     .end
        mov     word [fail_reason], r_none
        mov     si, s_folder
        call    fail_line
.end:
        jmp     t_done

s_search        db      "FACTORY\PROFILES\*.*", 0
s_folder        db      "FACTORY\PROFILES", 0
s_colon         db      ": $"
r_noname        db      "not a profile name /G: takes$"
r_norbg         db      "no .RBG of the folder's name$"
r_none          db      "no profile found$"
patch_failed    db      0
found           dw      0
dta             times 43 db 0
