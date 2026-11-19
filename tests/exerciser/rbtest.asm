; RBTEST - ReBeep's speaker exerciser. Plays known speaker cases for listening
; checks, runs unattended behaviour checks in the RESULT protocol (optionally
; against ReBeep's state through AMIS), probes free conventional memory and
; benchmarks the cost of a trapped port write. Run RBTEST /? for the options.
; Exit code: 0 = every check passed, 1 = otherwise.
; SPDX-License-Identifier: MIT

        cpu     8086
        org     100h

%include "speaker.inc"
%include "amis.inc"

STACK_SIZE      equ 512
MEM_MIN         equ 1000h       ; paragraphs (64 KB): below this a reading is not believable
GOOD_DIV        equ 1193        ; 1 kHz, inside the translatable range
OTHER_DIV       equ 1194
BAD_DIV         equ 100         ; above the OPL's range: the real speaker must play it
BENCH_TICKS     equ 18          ; at least one second per timing run
CAL_TICKS       equ 9

MD_MENU         equ 0
MD_CASE         equ 1
MD_AUTO         equ 2
MD_SAVE         equ 3
MD_SAME         equ 4
MD_BENCH        equ 5

; PASS "name" / FAIL "name", "detail" / FAILB "name", "detail=" (AL in hex) /
; FAIL2B "name", "first=", " second=" (AL, then AH, in hex). Each prints one
; result line; every FAIL counts toward the exit code.
%macro PASS 1
        mov     dx, %%name
        call    rep_pass
        jmp     %%done
%%name  db      %1, '$'
%%done:
%endmacro

%macro FAIL 2
        mov     dx, %%name
        call    rep_fail_head
        mov     dx, %%detail
        call    print
        call    crlf
        jmp     %%done
%%name  db      %1, '$'
%%detail db     %2, '$'
%%done:
%endmacro

%macro FAILB 2
        push    ax
        mov     dx, %%name
        call    rep_fail_head
        mov     dx, %%detail
        call    print
        pop     ax
        call    hexbyte
        call    crlf
        jmp     %%done
%%name  db      %1, '$'
%%detail db     %2, '$'
%%done:
%endmacro

%macro FAIL2B 3
        push    ax
        mov     dx, %%name
        call    rep_fail_head
        mov     dx, %%first
        call    print
        pop     ax
        push    ax
        call    hexbyte
        mov     dx, %%second
        call    print
        pop     ax
        mov     al, ah
        call    hexbyte
        call    crlf
        jmp     %%done
%%name  db      %1, '$'
%%first db      %2, '$'
%%second db     %3, '$'
%%done:
%endmacro

start:
        ; DOS gives a .COM the largest free block, which leaves nothing for AH=48h
        ; to report. Keep only this image and a stack, then measure what is left.
        mov     sp, image_end + STACK_SIZE
        push    cs
        pop     es
        mov     bx, (image_end - start + 100h + STACK_SIZE + 15) >> 4
        mov     ah, 4Ah
        int     21h
        jnc     .shrunk
        mov     dx, s_noshrink
        call    print
        mov     al, 1
        jmp     exit_al
.shrunk:
        mov     ax, 2523h
        mov     dx, ctrlc
        int     21h
        call    parse
        cmp     byte [want_res], 0
        je      .dispatch
        cmp     byte [mode], MD_AUTO
        jne     bad_usage
.dispatch:
        mov     al, [mode]
        cmp     al, MD_CASE
        jne     .n1
        mov     al, [case_n]
        call    run_case
        xor     al, al
        jmp     exit_al
.n1:    cmp     al, MD_AUTO
        jne     .n2
        jmp     run_auto
.n2:    cmp     al, MD_SAVE
        jne     .n3
        jmp     run_memsave
.n3:    cmp     al, MD_SAME
        jne     .n4
        jmp     run_memsame
.n4:    cmp     al, MD_BENCH
        jne     .n5
        jmp     run_bench
.n5:    jmp     run_menu

; Leaves the speaker off and 61h bits 0-1 clear, then exits with AL as the code.
exit_al:
        push    ax
        call    spk_off
        pop     ax
        mov     ah, 4Ch
        int     21h

; INT 23h (Ctrl+C): restore and exit.
ctrlc:
        push    cs
        pop     ds
        mov     al, 1
        jmp     exit_al

bad_usage:
        mov     dx, s_usage
        call    print
        mov     al, 1
        jmp     exit_al

show_help:
        mov     dx, s_help
        call    print
        xor     al, al
        jmp     exit_al

; ---------------------------------------------------------------- command line

parse:
        mov     si, 81h
        mov     di, 81h
        mov     bl, [80h]
        xor     bh, bh
        add     di, bx
.skip:
        cmp     si, di
        jae     .done
        mov     al, [si]
        cmp     al, ' '
        je      .blank
        cmp     al, 9
        je      .blank
        cmp     al, 13
        je      .done
        cmp     al, '/'
        je      .opt
        cmp     al, '-'
        je      .opt
        mov     [label_ptr], si
        xor     cx, cx
.lab:
        inc     si
        inc     cx
        cmp     si, di
        jae     .labend
        cmp     byte [si], ' '
        ja      .lab
.labend:
        mov     [label_len], cx
        jmp     .skip
.blank:
        inc     si
        jmp     .skip
.opt:
        mov     al, [si + 1]
        cmp     al, '?'
        jne     .o1
        jmp     show_help
.o1:
        and     al, 0DFh
        cmp     al, 'A'
        jne     .o2
        cmp     byte [si + 2], ' '
        ja      .bad
        mov     byte [mode], MD_AUTO
        add     si, 2
        jmp     .skip
.o2:
        cmp     al, 'R'
        jne     .o3
        cmp     byte [si + 2], ' '
        ja      .bad
        mov     byte [want_res], 1
        add     si, 2
        jmp     .skip
.o3:
        cmp     al, 'B'
        jne     .o4
        cmp     byte [si + 2], ' '
        ja      .bad
        mov     byte [mode], MD_BENCH
        add     si, 2
        jmp     .skip
.o4:
        cmp     al, 'C'
        jne     .o5
        cmp     byte [si + 2], ':'
        jne     .bad
        mov     al, [si + 3]
        sub     al, '0'
        cmp     al, 9
        ja      .bad
        or      al, al
        jnz     .cn
        mov     al, 10                  ; case 0 is the tenth
.cn:
        mov     [case_n], al
        cmp     byte [si + 4], ' '
        ja      .bad
        mov     byte [mode], MD_CASE
        add     si, 4
        jmp     .skip
.o5:
        cmp     al, 'M'
        jne     .bad
        cmp     byte [si + 2], ':'
        jne     .bad
        mov     al, [si + 3]
        and     al, 0DFh
        cmp     al, 'S'
        jne     .bad
        mov     al, [si + 4]
        and     al, 0DFh
        cmp     al, 'A'
        jne     .bad
        mov     al, [si + 6]
        and     al, 0DFh
        cmp     al, 'E'
        jne     .bad
        cmp     byte [si + 7], ' '
        ja      .bad
        mov     al, [si + 5]
        and     al, 0DFh
        mov     bl, MD_SAVE
        cmp     al, 'V'
        je      .m
        mov     bl, MD_SAME
        cmp     al, 'M'
        jne     .bad
.m:
        mov     [mode], bl
        add     si, 7
        jmp     .skip
.bad:
        jmp     bad_usage
.done:
        ret

; ---------------------------------------------------------------- output

; print the $-terminated string at DS:DX
print:
        mov     ah, 09h
        int     21h
        ret

; print the character in DL
putc:
        mov     ah, 02h
        int     21h
        ret

crlf:
        mov     dx, s_crlf
        jmp     print

; print AL as two hex digits; preserves every register
hexbyte:
        push    ax
        push    cx
        push    dx
        mov     ch, al
        mov     cl, 4
        shr     al, cl
        call    hexdigit
        mov     al, ch
        and     al, 0Fh
        call    hexdigit
        pop     dx
        pop     cx
        pop     ax
        ret

hexdigit:
        add     al, '0'
        cmp     al, '9'
        jbe     .out
        add     al, 'A' - '9' - 1
.out:
        mov     dl, al
        jmp     putc

; print AX as an unsigned decimal; preserves every register
printdec:
        push    ax
        push    bx
        push    cx
        push    dx
        mov     bx, 10
        xor     cx, cx
.div:
        xor     dx, dx
        div     bx
        push    dx
        inc     cx
        or      ax, ax
        jnz     .div
.out:
        pop     dx
        add     dl, '0'
        call    putc
        loop    .out
        pop     dx
        pop     cx
        pop     bx
        pop     ax
        ret

; print AX (tenths) as "x.x"; preserves every register
print_tenths:
        push    ax
        push    bx
        push    dx
        xor     dx, dx
        mov     bx, 10
        div     bx
        call    printdec
        push    dx
        mov     dl, '.'
        call    putc
        pop     dx
        add     dl, '0'
        call    putc
        pop     dx
        pop     bx
        pop     ax
        ret

; DX = name: "PASS name"
rep_pass:
        push    dx
        mov     dx, s_pass
        call    print
        pop     dx
        call    print
        jmp     crlf

; DX = name: "FAIL name: " and counts the failure
rep_fail_head:
        inc     byte [fails]
        push    dx
        mov     dx, s_fail
        call    print
        pop     dx
        call    print
        mov     dx, s_colon
        jmp     print

; the label given on the command line (default "memsame"), written to stdout
print_label:
        mov     bx, 1
        mov     cx, [label_len]
        mov     dx, [label_ptr]
        mov     ah, 40h
        int     21h
        ret

label_head:
        inc     byte [fails]
        mov     dx, s_fail
        call    print
        call    print_label
        mov     dx, s_colon
        jmp     print

; ---------------------------------------------------------------- speaker and timing

; AX = divisor: control word (channel 2, LSB/MSB, mode 3), then the count
pit_tone:
        push    ax
        mov     al, 0B6h
        out     PIT_CTRL, al
        pop     ax

; AX = divisor: count bytes only
set_div:
        out     PIT_CH2, al
        mov     al, ah
        out     PIT_CH2, al
        ret

; gate and speaker on; clobbers AL
spk_on:
        in      al, SYS_CTRL
        or      al, SC_GATE2 | SC_SPKR
        out     SYS_CTRL, al
        ret

; gate and speaker off; clobbers AL
spk_off:
        in      al, SYS_CTRL
        and     al, 0FCh
        out     SYS_CTRL, al
        ret

; AX = BIOS tick counter, low word
tick_lo:
        push    ds
        mov     ax, 40h
        mov     ds, ax
        mov     ax, [6Ch]
        pop     ds
        ret

; returns on the next tick change
tick_edge:
        push    ax
        push    bx
        call    tick_lo
        mov     bx, ax
.w:
        call    tick_lo
        cmp     ax, bx
        je      .w
        pop     bx
        pop     ax
        ret

; Esc or Ctrl+C: restore and exit
poll_key:
        push    ax
        mov     ah, 01h
        int     16h
        jz      .none
        mov     ah, 00h
        int     16h
        cmp     al, 1Bh
        je      .quit
        cmp     al, 03h
        je      .quit
.none:
        pop     ax
        ret
.quit:
        xor     al, al
        jmp     exit_al

; CX = whole ticks, counted from the next tick edge; Esc quits. Preserves registers.
wait_ticks:
        push    ax
        push    bx
        call    tick_lo
        mov     bx, ax
.sync:
        call    poll_key
        call    tick_lo
        cmp     ax, bx
        je      .sync
        mov     bx, ax
.w:
        call    poll_key
        call    tick_lo
        sub     ax, bx
        cmp     ax, cx
        jb      .w
        pop     bx
        pop     ax
        ret

; busy-wait DX:AX loop units
spin:
.l:
        sub     ax, 1
        sbb     dx, 0
        jnc     .l
        ret

; DX:AX = DX:AX * CX (the product must fit 32 bits); preserves BX
mul32_16:
        push    bx
        mov     bx, ax
        mov     ax, dx
        mul     cx
        xchg    ax, bx
        mul     cx
        add     dx, bx
        pop     bx
        ret

; DX:AX = DX:AX / CX
div32_16:
        push    bx
        mov     bx, ax
        mov     ax, dx
        xor     dx, dx
        div     cx
        xchg    ax, bx
        div     cx
        mov     dx, bx
        pop     bx
        ret

; Measures how many spin units one BIOS tick holds, then the 30 ms and 20 ms delays.
calibrate:
        cmp     byte [cal_done], 0
        jne     .ret
        mov     word [n_lo], 1024
        mov     word [n_hi], 0
.again:
        call    tick_edge
        call    tick_lo
        mov     [t_start], ax
        mov     ax, [n_lo]
        mov     dx, [n_hi]
        call    spin
        call    tick_lo
        sub     ax, [t_start]
        mov     [b_ticks], ax
        cmp     ax, CAL_TICKS
        jae     .done
        test    word [n_hi], 8000h
        jnz     .done
        shl     word [n_lo], 1
        rcl     word [n_hi], 1
        jmp     .again
.done:
        mov     cx, [b_ticks]
        or      cx, cx
        jnz     .have
        mov     cx, 1
.have:
        mov     ax, [n_lo]
        mov     dx, [n_hi]
        call    div32_16
        mov     [u_tick], ax
        mov     [u_tick + 2], dx
        mov     cx, 6
        call    mul32_16
        mov     cx, 11
        call    div32_16
        mov     [u_on], ax
        mov     [u_on + 2], dx
        mov     ax, [u_tick]
        mov     dx, [u_tick + 2]
        mov     cx, 4
        call    mul32_16
        mov     cx, 11
        call    div32_16
        mov     [u_off], ax
        mov     [u_off + 2], dx
        mov     byte [cal_done], 1
.ret:
        ret

; ---------------------------------------------------------------- listening cases

; AL = 1..10 (10 is case 0)
run_case:
        xor     ah, ah
        mov     bx, ax
        shl     bx, 1
        call    word [case_tab - 2 + bx]
        ret

case1:
        mov     dx, t_c1
        call    print
        mov     si, c1_divs
        mov     cx, 4
.n:
        push    cx
        lodsw
        push    si
        call    pit_tone
        call    spk_on
        mov     cx, 36
        call    wait_ticks
        call    spk_off
        pop     si
        pop     cx
        loop    .n
        ret

case2:
        mov     dx, t_c2
        call    print
        mov     word [cur], 4000
        mov     ax, [cur]
        call    pit_tone
        call    spk_on
.up:
        mov     ax, [cur]
        call    set_div
        mov     cx, 1
        call    wait_ticks
        sub     word [cur], 40
        cmp     word [cur], 600
        ja      .up
.dn:
        mov     ax, [cur]
        call    set_div
        mov     cx, 1
        call    wait_ticks
        add     word [cur], 40
        cmp     word [cur], 4000
        jb      .dn
        call    spk_off
        ret

case3:
        mov     dx, t_c3
        call    print
        mov     ax, [arp]
        call    pit_tone
        call    spk_on
        mov     byte [cnt], 5
.round:
        mov     si, arp
        mov     di, 6
.note:
        lodsw
        call    set_div
        mov     cx, 1
        call    wait_ticks
        dec     di
        jnz     .note
        dec     byte [cnt]
        jnz     .round
        call    spk_off
        ret

case4:
        mov     dx, t_c4
        call    print
        call    calibrate
        call    spk_off
        mov     word [cur], 4000
        mov     byte [cnt], 20
.b:
        mov     ax, [cur]
        call    pit_tone
        call    spk_on
        mov     ax, [u_on]
        mov     dx, [u_on + 2]
        call    spin
        call    spk_off
        mov     ax, [u_off]
        mov     dx, [u_off + 2]
        call    spin
        sub     word [cur], 150
        dec     byte [cnt]
        jnz     .b
        ret

case5:
        mov     dx, t_c5
        call    print
        in      al, SYS_CTRL
        and     al, 0FCh
        mov     bl, al
        mov     dx, 0ACE1h
        call    tick_lo
        mov     [t_start], ax
.l:
        mov     ax, dx
        mov     cl, 7
        shl     ax, cl
        xor     dx, ax
        mov     ax, dx
        mov     cl, 9
        shr     ax, cl
        xor     dx, ax
        mov     ax, dx
        mov     cl, 8
        shl     ax, cl
        xor     dx, ax
        mov     al, bl
        test    dl, 1
        jz      .o
        or      al, SC_SPKR
.o:
        out     SYS_CTRL, al
        call    tick_lo
        sub     ax, [t_start]
        cmp     ax, 36
        jb      .l
        call    spk_off
        ret

case6:
        mov     dx, t_c6
        call    print
        mov     ax, BAD_DIV
        jmp     steady

case7:
        mov     dx, t_c7
        call    print
        xor     ax, ax

; AX = divisor: hold it for two seconds
steady:
        call    pit_tone
        call    spk_on
        mov     cx, 36
        call    wait_ticks
        call    spk_off
        ret

case8:
        mov     dx, t_c8
        call    print
        mov     ax, 2712
        call    pit_tone
        call    spk_on
        xor     di, di
        call    tick_lo
        mov     [t_start], ax
        in      al, SYS_CTRL
        and     al, SC_OUT2
        mov     bl, al
.l:
        in      al, SYS_CTRL
        and     al, SC_OUT2
        cmp     al, bl
        je      .t
        mov     bl, al
        inc     di
.t:
        call    tick_lo
        sub     ax, [t_start]
        cmp     ax, 36
        jb      .l
        call    spk_off
        mov     dx, t_edges
        call    print
        mov     ax, di
        call    printdec
        jmp     crlf

case9:
        mov     dx, t_c9
        call    print
        call    spk_off
        in      al, SYS_CTRL
        and     al, 3
        call    hexbyte
        jmp     crlf

; Case 4's beeps the way Grand Prix Circuit plays them in a race: the speaker bit stays on
; between notes and the gate alone starts and stops each one, with a read-modify-write of
; bit 1 while it sounds.
case10:
        mov     dx, t_c10
        call    print
        call    calibrate
        call    spk_off
        in      al, SYS_CTRL
        or      al, SC_SPKR             ; parked: speaker bit on, gate off
        out     SYS_CTRL, al
        mov     cx, 9                   ; half a second
        call    wait_ticks
        mov     word [cur], 4000
        mov     byte [cnt], 20
.b:
        mov     ax, [cur]
        call    pit_tone
        in      al, SYS_CTRL
        or      al, SC_GATE2
        out     SYS_CTRL, al
        call    gpc_rmw
        mov     ax, [u_on]
        mov     dx, [u_on + 2]
        call    spin
        in      al, SYS_CTRL
        and     al, 0FFh ^ SC_GATE2
        out     SYS_CTRL, al
        mov     ax, [u_off]
        mov     dx, [u_off + 2]
        call    spin
        sub     word [cur], 150
        dec     byte [cnt]
        jnz     .b
        jmp     spk_off

; GPC's per-tick update of bit 1, which keeps bit 0 as it reads it. Clobbers AL.
gpc_rmw:
        in      al, SYS_CTRL
        and     al, 0FFh ^ SC_SPKR
        or      al, SC_SPKR
        out     SYS_CTRL, al
        ret

run_menu:
        mov     dx, s_menu
        call    print
.key:
        mov     ah, 00h
        int     16h
        cmp     al, 1Bh
        je      .quit
        cmp     al, 03h
        je      .quit
        cmp     al, '0'
        jb      .key
        cmp     al, '9'
        ja      .key
        sub     al, '0'
        jnz     .run
        mov     al, 10
.run:
        call    run_case
        mov     dx, s_prompt
        call    print
        jmp     .key
.quit:
        xor     al, al
        jmp     exit_al

; ---------------------------------------------------------------- memory

; Out: BX = the largest free conventional block, in paragraphs.
measure:
        mov     ah, 48h
        mov     bx, 0FFFFh
        int     21h
        jc      .got
        mov     es, ax
        mov     ah, 49h
        int     21h
        mov     bx, 0FFFFh
.got:
        ret

run_memsave:
        call    measure
        mov     [mem_val], bx
        cmp     bx, MEM_MIN
        jae     .ok
        FAIL    "memsave", "implausible"
        mov     al, 1
        jmp     exit_al
.ok:
        mov     ah, 3Ch
        xor     cx, cx
        mov     dx, s_file
        int     21h
        jc      .werr
        mov     bx, ax
        mov     ah, 40h
        mov     cx, 2
        mov     dx, mem_val
        int     21h
        jc      .wclose
        cmp     ax, 2
        jne     .wclose
        mov     ah, 3Eh
        int     21h
        jc      .werr
        PASS    "memsave"
        xor     al, al
        jmp     exit_al
.wclose:
        mov     ah, 3Eh
        int     21h
.werr:
        FAIL    "memsave", "cannot write RBMEM.DAT"
        mov     al, 1
        jmp     exit_al

run_memsame:
        call    measure
        mov     [mem_val], bx
        cmp     word [label_len], 0
        jne     .named
        mov     word [label_ptr], s_defname
        mov     word [label_len], 7
.named:
        cmp     bx, MEM_MIN
        jae     .read
        call    label_head
        mov     dx, s_implaus
        jmp     .fail
.read:
        mov     ax, 3D00h
        mov     dx, s_file
        int     21h
        jnc     .opened
        call    label_head
        mov     dx, s_missing
        jmp     .fail
.opened:
        mov     bx, ax
        mov     ah, 3Fh
        mov     cx, 2
        mov     dx, mem_old
        int     21h
        jc      .rerr
        cmp     ax, 2
        jne     .rerr
        mov     ah, 3Eh
        int     21h
        mov     ax, [mem_old]
        cmp     ax, [mem_val]
        jne     .differ
        mov     dx, s_pass
        call    print
        call    print_label
        call    crlf
        xor     al, al
        jmp     exit_al
.rerr:
        mov     ah, 3Eh
        int     21h
        call    label_head
        mov     dx, s_unreadable
        jmp     .fail
.differ:
        call    label_head
        mov     dx, s_before
        call    print
        mov     ax, [mem_old]
        call    printdec
        mov     dx, s_now
        call    print
        mov     ax, [mem_val]
        call    printdec
        call    crlf
        mov     al, 1
        jmp     exit_al
.fail:
        call    print
        call    crlf
        mov     al, 1
        jmp     exit_al

; ---------------------------------------------------------------- unattended checks

run_auto:
        cmp     byte [want_res], 0
        je      .base
        call    find_amis
        jnc     .found
        FAIL    "resident", "ReBeep is not loaded"
        mov     al, 1
        jmp     exit_al
.found:
        mov     bx, RBS_VERSION
        call    get_b
        cmp     al, RBS_LAYOUT
        je      .base
        FAILB   "resident", "unsupported RB_STATE layout "
        mov     al, 1
        jmp     exit_al
.base:
        call    chk_readview
        call    chk_timer
        cmp     byte [want_res], 0
        je      .restore
        call    chk_tone_mode
        call    chk_pitch_glide
        call    chk_stepped
        call    chk_raw_toggle
        call    chk_out_of_range
        call    chk_silent_after
        call    find_qpi
        jnc     .qpi
        FAIL    "qpi", "QPIEMU not loaded"
        jmp     .restore
.qpi:
        call    chk_masked
        call    chk_raw_unmasked
        call    chk_handoff
        call    chk_rest_held
        call    chk_gate_masked
        call    chk_gate_rmw
        call    chk_gate_out2
        call    chk_gate_pitch
        call    chk_gate_off
        call    chk_gate_handoff
        call    chk_gate_translate
        call    chk_gate_trapsoff       ; last: it turns the traps off and on again
.restore:
        call    chk_restore
        cmp     byte [fails], 0
        je      .ok
        mov     al, 1
        jmp     exit_al
.ok:
        xor     al, al
        jmp     exit_al

chk_readview:
        call    spk_off
        mov     ax, GOOD_DIV
        call    pit_tone
        call    spk_on
        in      al, SYS_CTRL
        and     al, 3
        cmp     al, 3
        je      .ok
        FAILB   "readview", "61h bits 0-1 read back as "
        ret
.ok:
        PASS    "readview"
        ret

chk_timer:
        call    spk_off
        mov     ax, GOOD_DIV
        call    pit_tone
        in      al, SYS_CTRL
        and     al, 0FCh
        or      al, SC_GATE2
        out     SYS_CTRL, al
        call    tick_edge
        call    tick_lo
        mov     bx, ax
        in      al, SYS_CTRL
        and     al, SC_OUT2
        mov     dl, al
.w:
        in      al, SYS_CTRL
        and     al, SC_OUT2
        cmp     al, dl
        jne     .ok
        call    tick_lo
        cmp     ax, bx
        je      .w
        FAIL    "timer-out2", "61h bit 5 did not toggle within one tick"
        call    spk_off
        ret
.ok:
        PASS    "timer-out2"
        call    spk_off
        ret

chk_restore:
        call    spk_off
        in      al, SYS_CTRL
        and     al, 3
        jz      .ok
        FAILB   "restore", "61h bits 0-1 still set: "
        ret
.ok:
        PASS    "restore"
        ret

; --- AMIS

; CF clear = ReBeep found, with [st_seg]:[st_off] -> RB_STATE
find_amis:
        mov     ax, 352Dh
        int     21h
        mov     ax, es
        or      ax, bx
        jz      .none
        mov     byte [amis_id], 0
.try:
        mov     ah, [amis_id]
        xor     al, al
        int     2Dh
        push    cs
        pop     ds
        cmp     al, 0FFh
        jne     .next
        mov     es, dx
        mov     si, amis_sig
        mov     cx, 16
        cld
        repe    cmpsb
        jne     .next
        mov     ah, [amis_id]
        mov     al, AMIS_FN_STATE
        int     2Dh
        push    cs
        pop     ds
        cmp     al, 0FFh
        jne     .none
        mov     [st_seg], dx
        mov     [st_off], bx
        clc
        ret
.next:
        inc     byte [amis_id]
        jnz     .try
.none:
        stc
        ret

; BX = RB_STATE offset. AL = the byte / AX = the word. Preserves the rest.
get_b:
        push    es
        push    si
        mov     es, [st_seg]
        mov     si, [st_off]
        mov     al, [es:si + bx]
        pop     si
        pop     es
        ret

get_w:
        push    es
        push    si
        mov     es, [st_seg]
        mov     si, [st_off]
        mov     ax, [es:si + bx]
        pop     si
        pop     es
        ret

st_mode:
        push    bx
        mov     bx, RBS_MODE
        call    get_b
        pop     bx
        ret

chk_tone_mode:
        call    spk_off
        mov     ax, GOOD_DIV
        call    pit_tone
        call    spk_on
        call    st_mode
        cmp     al, M_TONE
        je      .mode
        FAILB   "tone-mode", "mode="
        ret
.mode:
        mov     bx, RBS_DIVISOR
        call    get_w
        cmp     ax, GOOD_DIV
        je      .ok
        FAIL    "tone-mode", "divisor does not match"
        ret
.ok:
        PASS    "tone-mode"
        ret

chk_pitch_glide:
        call    spk_off
        mov     ax, GOOD_DIV
        call    pit_tone
        call    spk_on
        mov     bx, RBS_TONE_ON
        call    get_w
        mov     [t0], ax
        mov     ax, 1500
        call    set_div
        call    st_mode
        cmp     al, M_TONE
        je      .mode
        FAILB   "pitch-glide", "mode="
        ret
.mode:
        mov     bx, RBS_TONE_ON
        call    get_w
        cmp     ax, [t0]
        je      .count
        FAIL    "pitch-glide", "tone-on count changed"
        ret
.count:
        mov     bx, RBS_DIVISOR
        call    get_w
        cmp     ax, 1500
        je      .ok
        FAIL    "pitch-glide", "divisor not updated"
        ret
.ok:
        PASS    "pitch-glide"
        ret

chk_stepped:
        call    spk_off
        mov     bx, RBS_TONE_ON
        call    get_w
        mov     [t0], ax
        mov     word [cur], 2000
        mov     byte [cnt], 10
.b:
        mov     ax, [cur]
        call    pit_tone
        call    spk_on
        call    spk_off
        add     word [cur], 100
        dec     byte [cnt]
        jnz     .b
        mov     bx, RBS_TONE_ON
        call    get_w
        sub     ax, [t0]
        cmp     ax, 10
        je      .count
        FAIL    "stepped-beeps", "tone-on count did not rise by 10"
        ret
.count:
        call    st_mode
        cmp     al, M_SILENT
        je      .ok
        FAILB   "stepped-beeps", "mode="
        ret
.ok:
        PASS    "stepped-beeps"
        ret

chk_raw_toggle:
        call    spk_off
        mov     bx, RBS_RAW
        call    get_w
        mov     [t0], ax
        in      al, SYS_CTRL
        and     al, 0FCh
        mov     bl, al
        mov     cx, 8
.t:
        mov     al, bl
        or      al, SC_SPKR
        out     SYS_CTRL, al
        mov     al, bl
        out     SYS_CTRL, al
        loop    .t
        mov     bx, RBS_RAW
        call    get_w
        cmp     ax, [t0]
        jne     .ok
        FAIL    "raw-toggle", "raw count did not increase"
        call    spk_off
        ret
.ok:
        PASS    "raw-toggle"
        call    spk_off
        ret

chk_out_of_range:
        call    spk_off
        mov     ax, BAD_DIV
        call    pit_tone
        call    spk_on
        call    st_mode
        cmp     al, M_RAW
        je      .ok
        FAILB   "out-of-range", "mode="
        ret
.ok:
        PASS    "out-of-range"
        ret

chk_silent_after:
        call    spk_off
        call    st_mode
        cmp     al, M_SILENT
        je      .ok
        FAILB   "silent-after", "mode="
        ret
.ok:
        PASS    "silent-after"
        ret

; --- the real port, read through QPI

; CF clear = QPI found, with its entry in [qpi]
find_qpi:
        xor     di, di
        mov     es, di
        mov     ax, 1684h
        mov     bx, 4354h
        int     2Fh
        or      al, al
        jnz     .none
        mov     ax, es
        or      ax, di
        jz      .none
        mov     [qpi], di
        mov     [qpi + 2], es
        clc
        ret
.none:
        stc
        ret

; AL = the real 61h, bypassing every trap. Preserves the rest.
qpi_read61:
        push    bx
        push    cx
        push    dx
        push    si
        push    di
        push    es
        mov     ax, 1A00h
        mov     dx, SYS_CTRL
        call    far [qpi]
        mov     al, bl
        pop     es
        pop     di
        pop     si
        pop     dx
        pop     cx
        pop     bx
        ret

chk_masked:
        call    spk_off
        mov     ax, GOOD_DIV
        call    pit_tone
        call    spk_on
        call    qpi_read61
        mov     ah, al
        in      al, SYS_CTRL
        xchg    al, ah
        mov     bl, ah
        and     bl, SC_SPKR
        jz      .bad
        mov     bl, al
        and     bl, 3
        cmp     bl, SC_GATE2
        je      .ok
.bad:
        FAIL2B  "masked", "real 61h=", " own 61h="
        call    spk_off
        ret
.ok:
        PASS    "masked"
        call    spk_off
        ret

chk_raw_unmasked:
        call    spk_off
        mov     ax, BAD_DIV
        call    pit_tone
        call    spk_on
        call    qpi_read61
        test    al, SC_SPKR
        jnz     .ok
        FAILB   "raw-unmasked", "real 61h="
        call    spk_off
        ret
.ok:
        PASS    "raw-unmasked"
        call    spk_off
        ret

chk_handoff:
        call    spk_off
        mov     ax, GOOD_DIV
        call    pit_tone
        call    spk_on
        mov     ax, BAD_DIV
        call    set_div
        call    qpi_read61
        test    al, SC_SPKR
        jnz     .set
        FAILB   "handoff", "real bit 1 not set by divisor 100, 61h="
        call    spk_off
        ret
.set:
        mov     ax, GOOD_DIV
        call    set_div
        call    qpi_read61
        test    al, SC_SPKR
        jz      .ok
        FAILB   "handoff", "real bit 1 not cleared by a valid divisor, 61h="
        call    spk_off
        ret
.ok:
        PASS    "handoff"
        call    spk_off
        ret

; AL = RBS_F_LOWFM or 0: set or clear the resident /L flag (interrupts off around the
; byte), then apply it through AMIS 11h. Clobbers BX, CX, DX.
set_low:
        push    es
        push    si
        mov     es, [st_seg]
        mov     si, [st_off]
        pushf
        cli
        and     byte [es:si + RBS_FLAGS], 0FFh ^ RBS_F_LOWFM
        or      [es:si + RBS_FLAGS], al
        popf
        pop     si
        pop     es
        mov     al, AMIS_FN_APPLY
        jmp     amis_fn

; A count below 20 Hz mid-tone is a rest by default: the real speaker stays held (01) and
; the mode is REST. With the /L flag set it is a tone. The flag ends as it was found.
chk_rest_held:
        mov     bx, RBS_FLAGS
        call    get_b
        and     al, RBS_F_LOWFM
        mov     [g_low], al
        xor     al, al
        call    set_low
        call    spk_off
        mov     ax, GOOD_DIV
        call    pit_tone
        call    spk_on
        mov     ax, 0FFFFh
        call    set_div
        call    real_view
        mov     [g_voff], ax
        call    st_mode
        mov     [g_mode], al
        mov     al, RBS_F_LOWFM
        call    set_low
        mov     ax, 0FFFFh              ; the flag applies from the next write
        call    set_div
        call    st_mode
        mov     [g_mode2], al
        mov     al, [g_low]
        call    set_low
        call    spk_off
        mov     ax, [g_voff]
        cmp     ax, (3 << 8) | SC_GATE2
        je      .mode
        FAIL2B  "rest-held", "real 61h bits 0-1=", " own="
        ret
.mode:
        mov     al, [g_mode]
        cmp     al, M_REST
        je      .low
        FAILB   "rest-held", "mode="
        ret
.low:
        mov     al, [g_mode2]
        cmp     al, M_TONE
        je      .ok
        FAILB   "rest-held", "with /L:1, mode="
        ret
.ok:
        PASS    "rest-held"
        ret

; --- gate-keyed notes (Grand Prix Circuit): the speaker bit stays on and the gate alone
; keys each note. The real speaker must stay where it rests, so ReBeep holds the real gate
; clear instead of bit 1: the real 61h reads 10 while the game reads its own 11.

; A gate-keyed note at GOOD_DIV: 61h 00, the count, 10 (parked), then 11 (note on).
gate_note:
        call    spk_off
        mov     ax, GOOD_DIV
        call    pit_tone
        in      al, SYS_CTRL
        or      al, SC_SPKR
        out     SYS_CTRL, al
        or      al, SC_GATE2
        out     SYS_CTRL, al
        ret

; AL = the real 61h bits 0-1 (through QPI), AH = the game's own (IN 61h). Preserves the rest.
real_view:
        call    qpi_read61
        and     al, 3
        mov     ah, al
        in      al, SYS_CTRL
        and     al, 3
        xchg    al, ah
        ret

; AL = an AMIS function: call ReBeep's. Out: AL as it returns. Clobbers BX, CX, DX.
amis_fn:
        mov     ah, [amis_id]
        int     2Dh
        ret

; AL = RBS_F_TRANSLATE or 0: set or clear the resident translation flag, with interrupts
; off so the hotkey can't change the byte in between. Preserves the rest.
set_translate:
        push    es
        push    si
        mov     es, [st_seg]
        mov     si, [st_off]
        pushf
        cli
        and     byte [es:si + RBS_FLAGS], 0FFh ^ RBS_F_TRANSLATE
        or      [es:si + RBS_FLAGS], al
        popf
        pop     si
        pop     es
        ret

chk_gate_masked:
        call    gate_note
        call    real_view
        cmp     ax, (3 << 8) | SC_SPKR
        je      .mode
        FAIL2B  "gate-masked", "real 61h bits 0-1=", " own="
        ret
.mode:
        call    st_mode
        cmp     al, M_TONE
        je      .ok
        FAILB   "gate-masked", "mode="
        ret
.ok:
        PASS    "gate-masked"
        ret

; The game's read-modify-write must keep its own gate, or it would end its own note.
chk_gate_rmw:
        call    gate_note
        mov     bx, RBS_TONE_ON
        call    get_w
        mov     [t0], ax
        mov     cx, 3
.rmw:
        call    gpc_rmw
        loop    .rmw
        call    real_view
        cmp     ax, (3 << 8) | SC_SPKR
        je      .count
        FAIL2B  "gate-rmw", "real 61h bits 0-1=", " own="
        ret
.count:
        mov     bx, RBS_TONE_ON
        call    get_w
        cmp     ax, [t0]
        je      .ok
        FAIL    "gate-rmw", "tone-on count changed"
        ret
.ok:
        PASS    "gate-rmw"
        ret

; The real gate is clear, so the real OUT2 stands still; bit 5 must still move, or a game
; waiting for its edge would hang.
chk_gate_out2:
        call    gate_note
        pushf
        cli                             ; an interrupt handler reading 61h would flip bit 5 too
        in      al, SYS_CTRL
        mov     bl, al
        in      al, SYS_CTRL
        mov     bh, al
        in      al, SYS_CTRL
        popf
        xor     bl, bh
        xor     bh, al
        and     bx, (SC_OUT2 << 8) | SC_OUT2
        cmp     bx, (SC_OUT2 << 8) | SC_OUT2
        je      .ok
        FAIL    "gate-out2", "61h bit 5 did not change between reads"
        ret
.ok:
        PASS    "gate-out2"
        ret

; A pitch change mid-note keeps the gate held.
chk_gate_pitch:
        call    gate_note
        mov     ax, OTHER_DIV
        call    set_div
        call    real_view
        cmp     ax, (3 << 8) | SC_SPKR
        je      .div
        FAIL2B  "gate-pitch", "real 61h bits 0-1=", " own="
        ret
.div:
        mov     bx, RBS_DIVISOR
        call    get_w
        cmp     ax, OTHER_DIV
        je      .ok
        FAIL    "gate-pitch", "divisor not updated"
        ret
.ok:
        PASS    "gate-pitch"
        ret

chk_gate_off:
        call    gate_note
        in      al, SYS_CTRL
        and     al, 0FFh ^ SC_GATE2
        out     SYS_CTRL, al
        call    real_view
        cmp     ax, (SC_SPKR << 8) | SC_SPKR
        je      .ok
        FAIL2B  "gate-off", "real 61h bits 0-1=", " own="
        ret
.ok:
        PASS    "gate-off"
        ret

; An out-of-range divisor hands the note to the real speaker: the real gate comes back.
chk_gate_handoff:
        call    gate_note
        mov     ax, BAD_DIV
        call    set_div
        call    real_view
        cmp     ax, 0303h
        je      .ok
        FAIL2B  "gate-handoff", "real 61h bits 0-1=", " own="
        call    spk_off
        ret
.ok:
        PASS    "gate-handoff"
        call    spk_off
        ret

; Translation off mid-note gives the note to the real speaker (11); back on, it returns to
; the OPL. The speaker has been sounding by then, so ReBeep holds bit 1 instead (01).
; The translation flag ends as it was found.
chk_gate_translate:
        mov     bx, RBS_FLAGS
        call    get_b
        and     al, RBS_F_TRANSLATE
        mov     [g_tr], al
        call    gate_note
        xor     al, al
        call    set_translate
        mov     al, AMIS_FN_APPLY
        call    amis_fn
        call    real_view
        mov     [g_voff], ax
        mov     al, RBS_F_TRANSLATE
        call    set_translate
        mov     al, AMIS_FN_APPLY
        call    amis_fn
        call    real_view
        mov     [g_von], ax
        mov     al, [g_tr]
        call    set_translate
        mov     al, AMIS_FN_APPLY
        call    amis_fn
        call    spk_off
        mov     ax, [g_voff]
        cmp     ax, 0303h
        je      .on
        FAIL2B  "gate-translate", "off: real 61h bits 0-1=", " own="
        ret
.on:
        mov     ax, [g_von]
        cmp     ax, (3 << 8) | SC_GATE2
        je      .ok
        FAIL2B  "gate-translate", "back on: real 61h bits 0-1=", " own="
        ret
.ok:
        PASS    "gate-translate"
        ret

; /OFF mid-note gives the real gate back (11), and /ON afterwards puts the traps back.
; Skipped while the traps are off. Runs last among the checks that need the traps.
chk_gate_trapsoff:
        mov     bx, RBS_FLAGS
        call    get_b
        test    al, RBS_F_TRAPS
        jnz     .go
        ret
.go:
        call    gate_note
        mov     al, AMIS_FN_TRAPS_OFF
        call    amis_fn
        mov     [g_off], al
        call    qpi_read61
        and     al, 3
        mov     [g_real], al
        mov     al, AMIS_FN_TRAPS_ON
        call    amis_fn
        mov     [g_on], al
        call    spk_off
        cmp     byte [g_on], 0FFh
        je      .on
        FAIL    "gate-trapsoff", "AMIS 12h refused"
        ret
.on:
        mov     bx, RBS_FLAGS
        call    get_b
        test    al, RBS_F_TRAPS
        jnz     .traps
        FAIL    "gate-trapsoff", "the traps are still off"
        ret
.traps:
        cmp     byte [g_off], 0FFh
        je      .off
        FAIL    "gate-trapsoff", "AMIS 13h refused"
        ret
.off:
        mov     al, [g_real]
        cmp     al, 3
        je      .ok
        FAILB   "gate-trapsoff", "real 61h bits 0-1 after /OFF="
        ret
.ok:
        PASS    "gate-trapsoff"
        ret

; ---------------------------------------------------------------- benchmark

; Runs a write loop (SI = its address; DX:CX = count) for N writes, doubling N
; from 256 until the run lasts BENCH_TICKS. Out: AX = tenths of a microsecond
; per write.
bench_measure:
        mov     word [n_lo], 256
        mov     word [n_hi], 0
.again:
        call    tick_edge
        call    tick_lo
        mov     [t_start], ax
        mov     cx, [n_lo]
        mov     dx, [n_hi]
        call    si
        call    tick_lo
        sub     ax, [t_start]
        mov     [b_ticks], ax
        cmp     ax, BENCH_TICKS
        jae     .done
        test    word [n_hi], 8000h
        jnz     .done
        shl     word [n_lo], 1
        rcl     word [n_hi], 1
        jmp     .again
.done:
        ; tenths of a microsecond = ticks * 549250 / N, N scaled to 16 bits
        mov     ax, 549250 & 0FFFFh
        mov     dx, 549250 >> 16
        mov     cx, [b_ticks]
        call    mul32_16
        mov     bx, [n_lo]
        mov     cx, [n_hi]
.shrink:
        or      cx, cx
        jz      .div
        shr     cx, 1
        rcr     bx, 1
        shr     dx, 1
        rcr     ax, 1
        jmp     .shrink
.div:
        or      bx, bx
        jz      .cap
        cmp     dx, bx
        jae     .cap
        div     bx
        ret
.cap:
        mov     ax, 0FFFFh
        ret

run_out61:
        in      al, SYS_CTRL
        and     al, 0FCh
.l:
        out     SYS_CTRL, al
        sub     cx, 1
        sbb     dx, 0
        jnc     .l
        ret

run_out80:
        in      al, SYS_CTRL
        and     al, 0FCh
.l:
        out     80h, al
        sub     cx, 1
        sbb     dx, 0
        jnc     .l
        ret

; alternating 1193 / 1194 count pairs on channel 2
run_tone:
        mov     bl, 0A9h
.l:
        mov     al, bl
        out     PIT_CH2, al
        mov     al, 04h
        out     PIT_CH2, al
        xor     bl, 3
        sub     cx, 1
        sbb     dx, 0
        jnc     .l
        ret

run_bench:
        mov     si, run_out61
        call    bench_measure
        mov     [b_out61], ax
        mov     si, run_out80
        call    bench_measure
        mov     [b_out80], ax
        call    spk_off
        mov     ax, GOOD_DIV
        call    pit_tone
        call    spk_on
        mov     si, run_tone
        call    bench_measure
        mov     [b_tone], ax
        call    spk_off

        mov     dx, s_b61
        call    print
        mov     ax, [b_out61]
        call    print_tenths
        mov     dx, s_us
        call    print
        mov     dx, s_b80
        call    print
        mov     ax, [b_out80]
        call    print_tenths
        mov     dx, s_us
        call    print
        mov     dx, s_btrap
        call    print
        mov     ax, [b_out61]
        sub     ax, [b_out80]
        jns     .pos
        neg     ax
        mov     dl, '-'
        push    ax
        call    putc
        pop     ax
.pos:
        call    print_tenths
        mov     dx, s_us
        call    print
        mov     dx, s_btone
        call    print
        mov     ax, [b_tone]
        call    print_tenths
        mov     dx, s_us
        call    print
        PASS    "bench"
        xor     al, al
        jmp     exit_al

; ---------------------------------------------------------------- data

s_pass      db "PASS $"
s_fail      db "FAIL $"
s_colon     db ": $"
s_crlf      db 13, 10, "$"
s_file      db "RBMEM.DAT", 0
s_defname   db "memsame"
s_implaus   db "implausible$"
s_missing   db "RBMEM.DAT missing$"
s_unreadable db "RBMEM.DAT unreadable$"
s_before    db "before $"
s_now       db ", now $"
s_b61       db "BENCH OUT61 $"
s_b80       db "BENCH OUT80 $"
s_btrap     db "BENCH TRAP $"
s_btone     db "BENCH TONE $"
s_us        db " us", 13, 10, "$"
s_noshrink  db "RBTEST: cannot resize its memory block", 13, 10, "$"
s_usage     db "RBTEST: bad option. RBTEST /? lists them.", 13, 10, "$"

s_help      db "RBTEST - ReBeep speaker exerciser", 13, 10
            db 13, 10
            db "  RBTEST           menu: 0-9 plays a case, Esc quits", 13, 10
            db "  RBTEST /C:n      play case n (0-9) once", 13, 10
            db "  RBTEST /A        unattended behaviour checks (PASS/FAIL lines)", 13, 10
            db "  RBTEST /A /R     also require ReBeep and check its state", 13, 10
            db "  RBTEST /M:SAVE   save the largest free block to RBMEM.DAT", 13, 10
            db "  RBTEST /M:SAME x compare it with the saved value, as test x", 13, 10
            db "  RBTEST /B        time OUT 61h against OUT 80h", 13, 10
            db "  RBTEST /?        this help", 13, 10
            db "Exit code 0 when every check passed, 1 otherwise.", 13, 10, "$"

s_menu      db "RBTEST - ReBeep speaker exerciser. Esc quits.", 13, 10
            db "  1  steady tones 220 440 880 1760 Hz", 13, 10
            db "  2  sweep up and down", 13, 10
            db "  3  fast arpeggio", 13, 10
            db "  4  stepped beeps, 30 ms on / 20 ms off", 13, 10
            db "  5  direct toggling, gate off (noise)", 13, 10
            db "  6  out-of-range pitch (divisor 100)", 13, 10
            db "  7  divisor 0, below 20 Hz (silent unless REBEEP /L:1)", 13, 10
            db "  8  timing loop on 61h bit 5", 13, 10
            db "  9  silence and restore", 13, 10
            db "  0  stepped beeps keyed by the gate (Grand Prix Circuit)", 13, 10
s_prompt    db "Case 0-9, Esc quits: $"

t_c1        db "1: steady tones, 2 s each", 13, 10, "$"
t_c2        db "2: sweep up and down", 13, 10, "$"
t_c3        db "3: fast arpeggio", 13, 10, "$"
t_c4        db "4: stepped beeps", 13, 10, "$"
t_c5        db "5: toggling bit 1, gate off", 13, 10, "$"
t_c6        db "6: divisor 100", 13, 10, "$"
t_c7        db "7: divisor 0", 13, 10, "$"
t_c8        db "8: timing loop on 61h bit 5", 13, 10, "$"
t_c9        db "9: silence; 61h bits 0-1 = $"
t_c10       db "0: stepped beeps keyed by the gate", 13, 10, "$"
t_edges     db "bit 5 edges in 2 s: $"

case_tab    dw case1, case2, case3, case4, case5, case6, case7, case8, case9, case10
c1_divs     dw 5424, 2712, 1356, 678
arp         dw 2281, 1810, 1522, 1140, 1522, 1810

amis_sig    db AMIS_SIG_MFR, AMIS_SIG_PROD

mode        db MD_MENU
want_res    db 0
case_n      db 1
fails       db 0
cal_done    db 0
amis_id     db 0
cnt         db 0
g_off       db 0
g_on        db 0
g_real      db 0
g_tr        db 0
g_low       db 0
g_mode      db 0
g_mode2     db 0
g_voff      dw 0
g_von       dw 0
label_ptr   dw 0
label_len   dw 0
st_seg      dw 0
st_off      dw 0
qpi         dw 0, 0
mem_val     dw 0
mem_old     dw 0
cur         dw 0
t0          dw 0
t_start     dw 0
b_ticks     dw 0
n_lo        dw 0
n_hi        dw 0
u_tick      dw 0, 0
u_on        dw 0, 0
u_off       dw 0, 0
b_out61     dw 0
b_out80     dw 0
b_tone      dw 0

image_end:
