; REBEEP.COM's startup part: options, the checks, the load path, the change path, unload
; and the messages. Everything from here on is freed when ReBeep goes resident.
; 8086 throughout, so the CPU check runs on anything. The checks are separate short
; routines (check_cpu, find_qpi, opl_detect, capture_install) that the VM cannot
; make fail; they are listed as manually verified in src/AGENTS.md.
; SPDX-License-Identifier: MIT

        cpu     8086
%include "exitcode.inc"

OPT_F           equ 0001h
OPT_P           equ 0002h
OPT_V           equ 0004h
OPT_K           equ 0008h
OPT_ON          equ 0010h
OPT_OFF         equ 0020h
OPT_S           equ 0040h
OPT_U           equ 0080h
OPT_HELP        equ 0100h
OPT_L           equ 0200h
OPT_R           equ 0400h
%ifdef REBEEP_TRACE
OPT_D           equ 0800h               ; dump the trace
%else
OPT_D           equ 0
%endif
OPT_G           equ 1000h               ; a game profile
OPT_CONFIG      equ OPT_F | OPT_P | OPT_G | OPT_V | OPT_K | OPT_L | OPT_R
OPT_CONTROL     equ OPT_ON | OPT_OFF | OPT_S | OPT_U | OPT_D

; Paragraphs kept resident, counted from the PSP: everything below resident_end.
RESIDENT_PARAS  equ (resident_end - image_start + 100h + 15) >> 4

%macro DIE 2                            ; print the message at %1, exit with code %2
        mov     dx, %1
        mov     al, %2
        jmp     die
%endmacro

startup_entry:
        cld
        call    parse_options
        jnc     .parsed
        DIE     msg_badopt, EXIT_BAD_OPTION
.parsed:
        test    word [opt_set], OPT_HELP
        jz      .nohelp
        jmp     show_help
.nohelp:
        call    check_cpu
        jnc     .cpu_ok
        DIE     msg_no386, EXIT_NO_386
.cpu_ok:
        call    find_prog_dir           ; before the environment is freed
        call    amis_search
        jc      .none
        jmp     change_path
.none:
        test    word [opt_set], OPT_CONTROL
        jz      load_path
        DIE     msg_notloaded, EXIT_NOT_LOADED

; ---------------------------------------------------------------- load path

; Every refusal before capture_install returns leaves the machine untouched, and
; capture_install undoes itself, so a refused load leaves nothing hooked or trapped.
load_path:
        call    find_qpi
        jnc     .qpi
        DIE     msg_noqpi, EXIT_NO_QPI
.qpi:
        call    opl_detect
        or      al, al
        jnz     .opl
        DIE     msg_noopl, EXIT_NO_OPL
.opl:
        mov     [load_opl], al
        cmp     byte [free_ok], 0
        jne     .slot
        DIE     msg_noslot, EXIT_FAILED
.slot:
        mov     al, [free_id]
        mov     [rb_amis_id], al
        mov     word [prof_dst], rules_tbl
        call    crit_on
        test    word [opt_set], OPT_G
        jz      .patch
        call    profile_select          ; a profile with a DEFAULT= sets OPT_P
        test    word [opt_set], OPT_P
        jnz     .patched
.patch:
        call    load_patch
.patched:
        call    crit_off
        push    cs
        pop     es
        mov     bx, RB_STATE
        call    apply_fields
        call    rb_apply_low
        cmp     byte [load_opl], 3
        jne     .trap
        or      byte [RB_STATE + RBS_FLAGS], RBS_F_OPL3
.trap:
        call    capture_install
        jnc     .trapped
        DIE     msg_trapped, EXIT_TRAPPED
.trapped:
        mov     al, [load_opl]
        pushf
        cli                             ; the traps are live: a write mid-init would find the
        call    rb_opl_start            ; voices half set, or swapped (engine/fx.asm)
        popf
        mov     ax, 3509h
        int     21h
        mov     [rb_old09], bx
        mov     [rb_old09 + 2], es
        mov     ax, 352Dh
        int     21h
        mov     [rb_old2d], bx
        mov     [rb_old2d + 2], es
        mov     [RB_STATE + RBS_PSP], cs
        mov     dx, kbd_isr
        mov     ax, 2509h
        int     21h
        mov     dx, amis_isr
        mov     ax, 252Dh
        int     21h
        mov     es, [2Ch]               ; the environment is not needed once resident
        mov     ah, 49h
        int     21h
        jc      .keep_env
        mov     word [2Ch], 0
.keep_env:
        call    print_loaded
        xor     bx, bx                  ; a resident copy must not keep a redirected output file open
.close:
        mov     ah, 3Eh
        int     21h
        inc     bx
        cmp     bx, 5
        jb      .close
        mov     dx, RESIDENT_PARAS
        mov     ax, 3100h
        int     21h

; ---------------------------------------------------------------- change path

; A copy is resident (res_id, res_seg, res_ident from amis_search).
change_path:
        mov     es, [res_seg]
        mov     di, [res_ident]
        add     di, 16
        mov     si, rb_ident + 16
.same:
        lodsb
        cmp     al, [es:di]
        jne     mismatch
        inc     di
        or      al, al
        jnz     .same
        mov     al, AMIS_FN_STATE
        call    amis_call
        cmp     al, 0FFh
        jne     mismatch
        mov     es, [res_seg]
        cmp     byte [es:bx + RBS_VERSION], RBS_LAYOUT
        jne     mismatch                ; one release, two layouts: a write would land in the wrong fields
        mov     [res_state], bx
        mov     al, AMIS_FN_PROFILE
        call    amis_call
        xor     dx, dx                  ; DX = the resident profile table, or 0
        cmp     al, 0FFh
        jne     .noprof
        mov     es, [res_seg]
        cmp     byte [es:bx + PT_LAYOUT], PROF_LAYOUT
        jne     .noprof
        mov     dx, bx
.noprof:
        mov     [prof_dst], dx
        or      dx, dx
        jnz     .prof
        test    word [opt_set], OPT_G
        jz      .prof
        jmp     mismatch                ; a copy that can't take this profile table
.prof:
        mov     ax, [opt_set]
        test    ax, OPT_U
        jnz     do_unload
        test    ax, OPT_ON
        jnz     do_on
        test    ax, OPT_OFF
        jnz     do_off
%ifdef REBEEP_TRACE
        test    ax, OPT_D
        jz      .nodump
        jmp     do_dump
.nodump:
%endif
        test    ax, OPT_CONFIG
        jnz     do_update
        jmp     do_status

mismatch:
        mov     es, [res_seg]
        mov     di, [res_ident]
        add     di, 16
        call    print_asciz
        DIE     msg_mismatch, EXIT_MISMATCH

do_status:
        mov     dx, msg_stat_1
        call    print
        mov     es, [res_seg]
        mov     bx, [res_state]
        mov     al, [es:bx + RBS_FLAGS]
        push    ax
        mov     ah, RBS_F_TRAPS
        call    print_onoff
        mov     dx, msg_stat_2
        call    print
        pop     ax
        mov     ah, RBS_F_TRANSLATE
        call    print_onoff
        mov     dx, msg_stat_3
        call    print
        mov     al, '2'
        test    byte [es:bx + RBS_FLAGS], RBS_F_OPL3
        jz      .type
        mov     al, '3'
.type:
        call    putc
        mov     dx, msg_stat_4
        call    print
        call    print_config
        mov     ax, [es:bx + RBS_TRAPPED]
        call    print_dec
        mov     dx, msg_stat_5
        call    print
        jmp     done_ok

do_update:
        test    word [opt_set], OPT_P
        jz      .profile
        call    crit_on
        call    select_patch
        call    crit_off
.profile:
        test    word [opt_set], OPT_G
        jz      .apply
        call    crit_on
        call    profile_select          ; a profile with a DEFAULT= sets OPT_P
        call    crit_off
.apply:
        mov     es, [res_seg]
        mov     bx, [res_state]
        call    apply_fields
        mov     al, AMIS_FN_APPLY
        call    amis_call
        mov     dx, msg_updated
        call    print
        mov     es, [res_seg]
        mov     bx, [res_state]
        call    print_config
        jmp     done_ok

do_on:
        mov     al, AMIS_FN_TRAPS_ON
        mov     dx, msg_on
        jmp     switch_traps
do_off:
        mov     al, AMIS_FN_TRAPS_OFF
        mov     dx, msg_off
switch_traps:
        push    dx
        call    amis_call
        pop     dx
        or      al, al
        jnz     .done
        DIE     msg_trapped, EXIT_TRAPPED
.done:
        call    print
        jmp     done_ok

do_unload:
        mov     al, AMIS_FN_UNINSTALL
        call    amis_call
        or      al, al
        jnz     .free
        DIE     msg_refused, EXIT_REFUSED
.free:
        mov     es, bx
        mov     ah, 49h
        int     21h
        jnc     .gone
        DIE     msg_doserr, EXIT_FAILED
.gone:
        mov     dx, msg_unloaded
        call    print
        jmp     done_ok

; ---------------------------------------------------------------- checks

; check_cpu: Out: CF set below a 386. FLAGS bits 12-15 stick at 1 on an 8086 and at 0 on
; a 286 in real mode; on a 386 they can be set and cleared.
check_cpu:
        pushf
        cli
        pushf
        pop     ax
        and     ax, 0FFFh
        push    ax
        popf
        pushf
        pop     ax
        and     ax, 0F000h
        cmp     ax, 0F000h
        je      .old
        pushf
        pop     ax
        or      ax, 0F000h
        push    ax
        popf
        pushf
        pop     ax
        and     ax, 0F000h
        jz      .old
        popf
        clc
        ret
.old:
        popf
        stc
        ret

; find_qpi: Jemm's QPI, found through INT 2Fh AX=1684h BX=4354h (AL = 0, ES:DI = the entry).
; Out: CF set when absent; otherwise the entry is in rb_qpi.
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
        mov     [rb_qpi], di
        mov     [rb_qpi + 2], es
        push    cs
        pop     es
        clc
        ret
.none:
        push    cs
        pop     es
        stc
        ret

; amis_search: look through the multiplex numbers with function 00h.
; Out: CF clear when a ReBeep is resident (res_id, res_seg, res_ident); CF set when none.
;      Either way free_ok is 1 and free_id the lowest unused number, if there is one.
amis_search:
        mov     byte [free_ok], 0
        mov     ax, 352Dh
        int     21h
        mov     ax, es
        or      ax, bx
        jnz     .scan
        mov     byte [free_ok], 1       ; no INT 2Dh handler at all: any number is free
        mov     byte [free_id], 0
        stc
        ret
.scan:
        mov     byte [scan_id], 0
.try:
        mov     ah, [scan_id]
        xor     al, al
        int     2Dh
        push    cs
        pop     ds
        cld
        or      al, al
        jnz     .used
        cmp     byte [free_ok], 0
        jne     .next
        mov     byte [free_ok], 1
        mov     al, [scan_id]
        mov     [free_id], al
        jmp     .next
.used:
        cmp     al, 0FFh
        jne     .next
        mov     [res_ident], di
        mov     [res_seg], dx
        mov     es, dx
        mov     si, rb_ident
        mov     cx, 16
        repe    cmpsb
        jne     .next
        mov     al, [scan_id]
        mov     [res_id], al
        push    cs
        pop     es
        clc
        ret
.next:
        inc     byte [scan_id]
        jnz     .try
        push    cs
        pop     es
        stc
        ret

; amis_call: AL = function, on the resident copy. Out: AL, BX as the function returns them.
amis_call:
        mov     ah, [res_id]
        int     2Dh
        push    cs
        pop     ds
        ret

; apply_fields: write the options named on the command line into the RB_STATE at ES:BX,
; and nothing else, so a change never resets the fields it did not name. /P: writes the
; patch select_patch left in pbuf, the name and the records in one go with interrupts off
; (a trapped write must never see half a record), or, when none could be used, the faithful
; voice and no patch. The profile table goes in the same go, at prof_dst: /P: or /F ends a
; profile that is on, and /G: puts profile_select's in its place, so a trapped write never
; finds a rule that names another profile's patch.
apply_fields:
        mov     ax, [opt_set]
        pushf
        cli
        cld
        mov     di, [prof_dst]
        or      di, di
        jz      .faithful
        test    ax, OPT_F | OPT_P       ; the last command wins
        jz      .profile
        mov     byte [es:di + PT_ACTIVE], 0
        mov     byte [es:di + PT_FXCOUNT], 0 ; and its effects: fx_find tests only the count
.profile:
        test    ax, OPT_G
        jz      .faithful
        cmp     byte [prof_ok], 0
        je      .faithful
        mov     si, prof_new
        mov     cx, PT_LEN
        rep     movsb
.faithful:
        test    ax, OPT_F
        jz      .patch
        mov     byte [es:bx + RBS_VOICE], 0
.patch:
        test    ax, OPT_P
        jz      .volume
        cmp     byte [patch_ok], 0
        je      .nopatch
        lea     di, [bx + RBS_PATCH]
        mov     si, pbuf
        mov     cx, PBLK_LEN
        rep     movsb
        mov     byte [es:bx + RBS_VOICE], 1
        jmp     .volume
.nopatch:
        mov     byte [es:bx + RBS_VOICE], 0
        mov     byte [es:bx + RBS_PFLAGS], 0
        mov     byte [es:bx + RBS_PATCH], 0
.volume:
        test    ax, OPT_V
        jz      .keys
        mov     dl, [opt_volume]
        mov     [es:bx + RBS_VOLUME], dl
.keys:
        test    ax, OPT_K
        jz      .low
        mov     dl, [opt_toggle]
        mov     [es:bx + RBS_TOGGLE_KEY], dl
        mov     dl, [opt_cycle]
        mov     [es:bx + RBS_CYCLE_KEY], dl
.low:
        test    ax, OPT_L
        jz      .mute
        and     byte [es:bx + RBS_FLAGS], 0FFh ^ RBS_F_LOWFM
        mov     dl, [opt_low]
        or      [es:bx + RBS_FLAGS], dl
.mute:
        test    ax, OPT_R
        jz      .done
        and     byte [es:bx + RBS_FLAGS], 0FFh ^ RBS_F_MUTE
        mov     dl, [opt_mute]
        or      [es:bx + RBS_FLAGS], dl
.done:
        popf
        ret

; ---------------------------------------------------------------- patches

; load_patch: the load path's patch. /P: names one, /F wants none, and with neither the
; settings file's PATCH= may. A patch found that way goes in as if /P: had named it, so
; apply_fields writes it; one that fails leaves the defaults (the faithful voice).
load_patch:
        mov     ax, [opt_set]
        test    ax, OPT_P
        jz      .settings
        jmp     select_patch
.settings:
        test    ax, OPT_F
        jnz     .ret
        call    settings_ensure
        mov     si, cfg_patch
        cmp     byte [si], 0
        je      .ret
        call    asciz_len
        call    spec_valid
        jnc     .valid
        mov     word [fail_spec], cfg_patch
        mov     word [fail_who], 0
        mov     word [fail_reason], r_badname
        jmp     print_not_used
.valid:
        call    select_patch
        cmp     byte [patch_ok], 0
        je      .ret
        or      word [opt_set], OPT_P
.ret:
        ret

; select_patch: looks the patch spec_buf names up and loads it into pbuf.
; Out: patch_ok = 1, or 0 with the reason printed. Clobbers ES.
select_patch:
        mov     byte [patch_ok], 0
        mov     si, spec_buf
        mov     bx, s_factory
        call    starts_with
        je      .lookup                 ; FACTORY is beside the program: no settings needed
        call    settings_ensure
.lookup:
        mov     word [fail_spec], spec_buf
        call    find_patch
        jc      print_not_used
        mov     byte [patch_ok], 1
        ret

; print_not_used: "Patch <spec> not used: [<who>: ]<reason>. Playing the faithful voice."
; from fail_spec, fail_who (0 for none) and fail_reason.
print_not_used:
        mov     dx, msg_pn_1
        call    print
        mov     si, [fail_spec]
        mov     cx, 40
        call    print_text
        mov     dx, msg_pn_2
        call    print
        mov     si, [fail_who]
        or      si, si
        jz      .reason
        mov     cx, 80
        call    print_text
        mov     dx, msg_pn_3
        call    print
.reason:
        mov     dx, [fail_reason]
        call    print
        mov     dx, msg_pn_4
        jmp     print

; ---------------------------------------------------------------- options

; parse_options: the command tail at PSP:80h into opt_set and the values.
; Out: CF set for a bad option. Touches no hardware.
parse_options:
        mov     word [opt_set], 0
        mov     si, 81h
        mov     al, [80h]
        xor     ah, ah
        add     ax, si
        mov     [opt_end], ax
.next:
        call    getc
        cmp     al, ' '
        je      .next
        cmp     al, 9
        je      .next
        cmp     al, 0Dh
        je      .valid
        cmp     al, '/'
        je      .opt
        cmp     al, '-'
        jne     .bad
.opt:
        call    getc
        call    lower
        mov     bx, OPT_HELP
        cmp     al, '?'
        je      .flag
        mov     bx, OPT_S
        cmp     al, 's'
        je      .flag
        mov     bx, OPT_U
        cmp     al, 'u'
        je      .flag
        mov     bx, OPT_F
        cmp     al, 'f'
        je      .flag
%ifdef REBEEP_TRACE
        mov     bx, OPT_D
        cmp     al, 'd'
        je      .flag
%endif
        cmp     al, 'o'
        je      .onoff
        cmp     al, 'p'
        je      .patch
        cmp     al, 'g'
        je      .profile
        cmp     al, 'v'
        je      .volume
        cmp     al, 'k'
        je      .keys
        cmp     al, 'l'
        je      .low
        cmp     al, 'r'
        je      .mute
.bad:
        stc
        ret

.mute:                                  ; /R:1 plays on the speaker, /R:0 sets the mute flag
        call    getc
        cmp     al, ':'
        jne     .bad
        call    get_number
        jc      .bad
        xor     ah, ah
        cmp     al, 1
        je      .muteset
        ja      .bad
        mov     ah, RBS_F_MUTE
.muteset:
        mov     [opt_mute], ah
        mov     bx, OPT_R
        jmp     .flag

.low:
        call    getc
        cmp     al, ':'
        jne     .bad
        call    get_number
        jc      .bad
        mov     ah, RBS_F_LOWFM
        cmp     al, 1
        je      .lowset
        ja      .bad
        xor     ah, ah
.lowset:
        mov     [opt_low], ah
        mov     bx, OPT_L
        jmp     .flag

.onoff:
        call    getc
        call    lower
        mov     bx, OPT_ON
        cmp     al, 'n'
        je      .flag
        cmp     al, 'f'
        jne     .bad
        call    getc
        call    lower
        mov     bx, OPT_OFF
        cmp     al, 'f'
        jne     .bad
        jmp     .flag

.patch:                                 ; /P:NAME or /P:FOLDER\NAME
        call    getc
        cmp     al, ':'
        jne     .bad
        call    opt_word
        push    si
        mov     si, bx
        call    spec_valid
        pop     si
        jc      .bad
        mov     bx, OPT_P
        jmp     .flag

.profile:                               ; /G:NAME, a game profile (profile_select)
        call    getc
        cmp     al, ':'
        jne     .bad
        call    opt_word
        push    si
        mov     si, bx
        call    name_valid              ; into spec_buf, which /P: also uses: they never meet
        jc      .gbad
        mov     si, spec_buf
        mov     di, prof_spec
        call    copy_upper
        pop     si
        mov     bx, OPT_G
        jmp     .flag
.gbad:
        pop     si
        jmp     .bad

.volume:
        call    getc
        cmp     al, ':'
        jne     .bad
        call    get_number
        jc      .bad
        cmp     ax, 15
        ja      .bad
        mov     [opt_volume], al
        mov     bx, OPT_V
        jmp     .flag

.keys:
        call    getc
        cmp     al, ':'
        jne     .bad
        call    get_key
        jc      .bad
        mov     [opt_toggle], al
        call    get_key
        jc      .bad
        mov     [opt_cycle], al
        cmp     al, [opt_toggle]
        je      .bad
        mov     bx, OPT_K

; An option ends at a space, a tab or the end of the line.
.flag:
        or      [opt_set], bx
        call    peekc
        cmp     al, ' '
        je      .next
        cmp     al, 9
        je      .next
        cmp     al, 0Dh
        jne     .bad
        jmp     .next

; One control option at a time, none beside a config option, and one of /F, /P: and /G:.
.valid:
        mov     ax, [opt_set]
        mov     bx, ax
        and     bx, OPT_CONTROL
        jz      .exclusive
        mov     cx, bx
        dec     cx
        and     cx, bx
        jnz     .bad
        test    ax, OPT_CONFIG
        jnz     .bad
.exclusive:
        and     ax, OPT_F | OPT_P | OPT_G
        mov     cx, ax
        dec     cx
        and     cx, ax                  ; nonzero when two of them are set
        jnz     .bad
        clc
        ret

; opt_word: SI = an option's value. Out: BX = its start, CX = its length up to a space, a tab
; or the end of the line, and SI past it.
opt_word:
        mov     bx, si
.next:
        call    peekc
        cmp     al, ' '
        je      .end
        cmp     al, 9
        je      .end
        cmp     al, 0Dh
        je      .end
        inc     si
        jmp     .next
.end:
        mov     cx, si
        sub     cx, bx
        ret

; getc: the next command-tail character, or CR at the end.
getc:
        cmp     si, [opt_end]
        jae     peekc
        lodsb
        ret
; peekc: the same without consuming it.
peekc:
        cmp     si, [opt_end]
        jae     .eol
        mov     al, [si]
        ret
.eol:
        mov     al, 0Dh
        ret

lower:
        cmp     al, 'A'
        jb      .done
        cmp     al, 'Z'
        ja      .done
        add     al, 20h
.done:
        ret

; get_number: decimal digits. Out: AX = 0..255; CF set without a digit or over 255.
get_number:
        push    bx
        push    cx
        push    dx
        xor     bx, bx
        xor     cx, cx
.digit:
        call    peekc
        sub     al, '0'
        cmp     al, 9
        ja      .end
        inc     si
        inc     cx
        mov     dx, bx
        shl     bx, 1
        shl     bx, 1
        add     bx, dx
        shl     bx, 1
        xor     ah, ah
        add     bx, ax
        cmp     bx, 255
        jbe     .digit
        jmp     .fail
.end:
        or      cx, cx
        jz      .fail
        mov     ax, bx
        clc
        jmp     .out
.fail:
        stc
.out:
        pop     dx
        pop     cx
        pop     bx
        ret

; get_key: a letter A-Z (either case) as its set-1 scan code. Out: AL, or CF set.
get_key:
        push    bx
        call    getc
        call    lower
        sub     al, 'a'
        cmp     al, 25
        ja      .bad
        mov     bl, al
        xor     bh, bh
        mov     al, [key_scan + bx]
        pop     bx
        clc
        ret
.bad:
        pop     bx
        stc
        ret

; ---------------------------------------------------------------- output

die:
        push    ax
        call    print
        pop     ax
        mov     ah, 4Ch
        int     21h

done_ok:
        mov     ax, 4C00h
        int     21h

show_help:
        mov     dx, msg_help
        call    print
        jmp     done_ok

print:
        mov     ah, 09h
        int     21h
        ret

putc:
        push    dx
        mov     dl, al
        mov     ah, 02h
        int     21h
        pop     dx
        ret

; print_asciz: the string at ES:DI, at most 40 characters.
print_asciz:
        push    ax
        push    cx
        push    di
        mov     cx, 40
.next:
        mov     al, [es:di]
        or      al, al
        jz      .done
        call    putc
        inc     di
        loop    .next
.done:
        pop     di
        pop     cx
        pop     ax
        ret

print_dec:
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
        pop     ax
        add     al, '0'
        call    putc
        loop    .out
        pop     dx
        pop     cx
        pop     bx
        pop     ax
        ret

; print_onoff: "on" if flags byte AL has mask AH set, else "off".
print_onoff:
        test    al, ah
        mov     dx, msg_on_word
        jnz     .print
        mov     dx, msg_off_word
.print:
        jmp     print

; scan_letter: AL = set-1 scan code -> AL = its letter, or '?'.
scan_letter:
        push    cx
        push    si
        mov     si, key_scan
        mov     cx, 26
.next:
        cmp     al, [si]
        je      .found
        inc     si
        loop    .next
        mov     al, '?'
        jmp     .out
.found:
        mov     al, 26
        sub     al, cl
        add     al, 'A'
.out:
        pop     si
        pop     cx
        ret

; print_config: "<voice>, volume <n>." then "Ctrl+Alt+<x> toggles, ..." and the /L and /R
; lines, from the RB_STATE at ES:BX, and a profile that is on, from the table at ES:prof_dst. A
; patch is named: "patch USER\BELL", and "(4-OP)" when an OPL3 plays its four-operator variant;
; the faithful voice names the patch it still holds: "faithful voice (patch USER\BELL loaded)".
print_config:
        push    ax
        push    dx
        push    di
        cmp     byte [es:bx + RBS_VOICE], 0
        jne     .patch
        mov     dx, msg_faithful
        call    print
        test    byte [es:bx + RBS_PFLAGS], RBS_PF_LOADED
        jz      .volume
        mov     dx, msg_held_1
        call    print
        lea     di, [bx + RBS_PATCH]
        call    print_asciz
        mov     dx, msg_held_2
        call    print
        jmp     .volume
.patch:
        mov     dx, msg_patch
        call    print
        lea     di, [bx + RBS_PATCH]
        call    print_asciz
        test    byte [es:bx + RBS_FLAGS], RBS_F_OPL3
        jz      .volume
        test    byte [es:bx + RBS_PFLAGS], RBS_PF_4OP
        jz      .volume
        mov     dx, msg_4op
        call    print
.volume:
        mov     dx, msg_volume
        call    print
        mov     al, [es:bx + RBS_VOLUME]
        xor     ah, ah
        call    print_dec
        mov     dx, msg_keys_1
        call    print
        mov     al, [es:bx + RBS_TOGGLE_KEY]
        call    scan_letter
        call    putc
        mov     dx, msg_keys_2
        call    print
        mov     al, [es:bx + RBS_CYCLE_KEY]
        call    scan_letter
        call    putc
        mov     dx, msg_keys_3
        call    print
        mov     dx, msg_low_0
        test    byte [es:bx + RBS_FLAGS], RBS_F_LOWFM
        jz      .low
        mov     dx, msg_low_1
.low:
        call    print
        mov     dx, msg_raw_1
        test    byte [es:bx + RBS_FLAGS], RBS_F_MUTE
        jz      .raw
        mov     dx, msg_raw_0
.raw:
        call    print
        mov     di, [prof_dst]
        or      di, di
        jz      .done
        cmp     byte [es:di + PT_ACTIVE], 0
        je      .done
        mov     dx, msg_prof_1
        call    print
        add     di, PT_NAME
        call    print_asciz
        mov     dx, msg_prof_2
        call    print
.done:
        pop     di
        pop     dx
        pop     ax
        ret

; print_loaded: the load summary.
print_loaded:
        mov     dx, msg_loaded_1
        call    print
        mov     dx, msg_upper
        mov     ax, cs
        cmp     ax, 0A000h
        jae     .where
        mov     dx, msg_conventional
.where:
        call    print
        mov     dx, msg_loaded_2
        call    print
        mov     ax, RESIDENT_PARAS
        mov     cl, 4
        shl     ax, cl
        call    print_dec
        mov     dx, msg_loaded_3
        call    print
        mov     al, '2'
        cmp     byte [load_opl], 3
        jne     .type
        mov     al, '3'
.type:
        call    putc
        mov     dx, msg_loaded_4
        call    print
        push    cs
        pop     es
        mov     bx, RB_STATE
        jmp     print_config

; ---------------------------------------------------------------- data

; Set-1 scan codes of A-Z, the letters /K: takes.
key_scan        db      1Eh, 30h, 2Eh, 20h, 12h, 21h, 22h, 23h, 17h, 24h, 25h, 26h, 32h
                db      31h, 18h, 19h, 10h, 13h, 1Fh, 14h, 16h, 2Fh, 11h, 2Dh, 15h, 2Ch

opt_set         dw      0
opt_end         dw      0
opt_volume      db      0
opt_toggle      db      0
opt_cycle       db      0
opt_low         db      0               ; RBS_F_LOWFM or 0
opt_mute        db      0               ; RBS_F_MUTE (/R:0) or 0

load_opl        db      0
scan_id         db      0
free_ok         db      0
free_id         db      0
res_id          db      0
res_seg         dw      0
res_ident       dw      0
res_state       dw      0
patch_ok        db      0               ; 1 when pbuf holds the patch /P: or PATCH= asked for
fail_spec       dw      0               ; the spec print_not_used names

msg_badopt      db      "Bad option. Run REBEEP /? for the options.", 13, 10, '$'
msg_no386       db      "ReBeep needs a 386 or better.", 13, 10, '$'
msg_noqpi       db      "QPIEMU is not loaded. Run JLOAD QPIEMU.DLL first (see README.TXT).", 13, 10, '$'
msg_noopl       db      "No OPL2/OPL3 found at port 388h.", 13, 10, '$'
msg_noslot      db      "No free AMIS multiplex number.", 13, 10, '$'
msg_trapped     db      "Another program already traps the speaker ports (for example SBEMU's PC-speaker feature).", 13, 10, '$'
msg_mismatch    db      " is loaded. Use that version's REBEEP to change or unload it.", 13, 10, '$'
msg_notloaded   db      "ReBeep is not loaded.", 13, 10, '$'
msg_refused     db      "Can't unload: another program hooked in after ReBeep. Unload it first.", 13, 10, '$'
msg_doserr      db      "DOS would not free ReBeep's memory.", 13, 10, '$'
msg_unloaded    db      "ReBeep unloaded.", 13, 10, '$'
msg_on          db      "ReBeep is on.", 13, 10, '$'
msg_off         db      "ReBeep is off: the OPL is free for the game.", 13, 10, '$'
msg_updated     db      "ReBeep updated: $"
msg_pn_1        db      "Patch $"
msg_pn_2        db      " not used: $"
msg_pn_3        db      ": $"
msg_pn_4        db      ". Playing the faithful voice.", 13, 10, '$'
r_badname       db      "not a valid patch name$"

msg_stat_1      db      REBEEP_NAME, " is loaded: traps $"
msg_stat_2      db      ", translation $"
msg_stat_3      db      ", OPL$"
msg_stat_4      db      ".", 13, 10, '$'
msg_stat_5      db      " speaker writes handled.", 13, 10, '$'
msg_on_word     db      "on$"
msg_off_word    db      "off$"

msg_loaded_1    db      REBEEP_NAME, " loaded in $"
msg_upper       db      "upper$"
msg_conventional db     "conventional$"
msg_loaded_2    db      " memory, $"
msg_loaded_3    db      " bytes resident.", 13, 10, "OPL$"
msg_loaded_4    db      ", $"

msg_faithful    db      "faithful voice$"
msg_held_1      db      " (patch $"
msg_held_2      db      " loaded)$"
msg_patch       db      "patch $"
msg_4op         db      " (4-OP)$"
msg_volume      db      ", volume $"
msg_keys_1      db      ".", 13, 10, "Ctrl+Alt+$"
msg_keys_2      db      " toggles, Ctrl+Alt+$"
msg_keys_3      db      " switches between faithful voice and patch.", 13, 10, '$'
msg_low_0       db      "Notes below 20 Hz are silent (/L:0).", 13, 10, '$'
msg_low_1       db      "Notes below 20 Hz are played (/L:1).", 13, 10, '$'
msg_raw_1       db      "Sounds ReBeep can't translate play on the speaker (/R:1).", 13, 10, '$'
msg_raw_0       db      "Sounds ReBeep can't translate are muted (/R:0).", 13, 10, '$'
msg_prof_1      db      "Profile $"
msg_prof_2      db      " picks the patch from what the game plays. /P: or /F ends it.", 13, 10, '$'

msg_help        db      REBEEP_NAME, " - plays PC-speaker beeps on a Sound Blaster's OPL2/OPL3.", 13, 10
                db      "Needs a 386 or better and Jemm's QPIEMU (JLOAD QPIEMU.DLL).", 13, 10, 13, 10
%ifdef REBEEP_TRACE
                db      "REBEEPD [/F | /P:name | /G:name] [/V:n] [/L:n] [/R:n] [/K:xy]", 13, 10
                db      "        [/ON | /OFF] [/S] [/U] [/D] [/?]", 13, 10
%else
                db      "REBEEP [/F | /P:name | /G:name] [/V:n] [/L:n] [/R:n] [/K:xy]", 13, 10
                db      "       [/ON | /OFF] [/S] [/U] [/?]", 13, 10
%endif
                db      "  /F       faithful square-wave voice (default)", 13, 10
                db      "  /P:name  a patch: FOLDER\NAME, or NAME from USER then FACTORY", 13, 10
                db      "  /G:name  a game profile, yours or one that comes with ReBeep", 13, 10
                db      "  /V:n     volume 0-15 (default 12)", 13, 10
                db      "  /L:n     notes below 20 Hz: 0 silent (default), 1 played", 13, 10
                db      "  /R:n     sounds it can't translate: 1 speaker (default), 0 muted", 13, 10
                db      "  /K:xy    Ctrl+Alt+x toggles, Ctrl+Alt+y switches voice (default BN)", 13, 10
                db      "  /OFF     stop trapping and release the OPL    /ON  trap again", 13, 10
                db      "  /S       status                               /U   unload", 13, 10
%ifdef REBEEP_TRACE
                db      "  /D       add the trace to D:\REBEEP\RBTRACE.TXT, then empty it", 13, 10
%endif
                db      "  /?       this help", 13, 10
                db      "/S, /U, /ON and /OFF act only on a loaded copy. Any other option on a", 13, 10
                db      "loaded copy changes only what it names. /P: or /F ends a profile.", 13, 10, 13, 10
                db      "Exit codes: 0 ok, 1 bad option, 2 CPU below 386, 3 no QPI, 4 no OPL,", 13, 10
                db      "5 speaker ports already trapped, 6 version mismatch, 7 not loaded,", 13, 10
                db      "8 unload refused, 9 other failure.", 13, 10, '$'
