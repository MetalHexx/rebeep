; The startup part's game profiles: /G:NAME reads PROFILES\NAME\NAME.RBG, a text file in the
; .RBP style, into a table of rules (include/profile.inc), and each patch it names from the same
; folder into a slot of that table. apply_fields then copies the table into the resident one.
;   [PROFILE]  FORMAT=1 (required), DEFAULT=NAME (optional: the patch that plays first)
;   [RULE]     STEP=KIND [VALUE [TOLERANCE]], one to four in order, then PATCH=NAME
; Kinds: NOTE and PITCH (a divisor, with a tolerance), CTRL (a byte), OFF (no value). A step
; without a value takes any. Numbers are decimal, or hex with a trailing H. Keys, kinds and
; section names in any case; ';' comment lines, blank lines, unknown keys and unknown sections
; are ignored; a duplicate key or [PROFILE] is invalid; at most 2048 bytes.
; 8086. Included after resident_end, so it is freed when going resident. Uses patch.asm's line
; helpers and parser, and files.asm's names, paths and reads.
; SPDX-License-Identifier: MIT

        cpu     8086
%include "profile.inc"

GS_NONE         equ     0               ; the section a line is in
GS_PROFILE      equ     1
GS_RULE         equ     2
GS_OTHER        equ     3
G_PROFILE       equ     01h             ; pg_seen
G_FORMAT        equ     02h
G_DEFAULT       equ     04h

%macro PFAIL 1
        mov     si, %1
        jmp     pg_fail
%endmacro

; profile_select: loads the profile prof_spec names into prof_new, and each of its patches into
; a slot. A profile that can't be used is reported and nothing changes (prof_ok = 0). A patch
; that can't be is reported, and its slot plays the faithful voice. When the profile has a
; DEFAULT=, its block goes into pbuf and OPT_P is set, as load_patch does for PATCH=, so
; apply_fields plays it. Run inside crit_on. Out: prof_ok. Clobbers ES.
profile_select:
        mov     byte [prof_ok], 0
        call    settings_ensure
        call    profiles_resolve
        push    ds
        pop     es
        cld
        mov     di, path_buf
        call    prof_folder
        mov     si, prof_spec
        call    copy_upper
        mov     si, s_rbg
        call    copy_upper
        mov     dx, path_buf
        mov     cx, PATCH_FILE_MAX + 1
        call    read_file
        jnc     .parse
        mov     si, r_notfound
        or      al, al
        jz      .failed
        mov     si, r_unread
        jmp     .failed
.parse:
        mov     cx, ax
        mov     si, io_buf
        call    profile_parse
        jnc     .parsed
.failed:
        mov     [fail_reason], si
        mov     dx, msg_gn_1
        call    print
        mov     si, prof_spec
        mov     cx, 8
        call    print_text
        mov     dx, msg_gn_2
        call    print
        mov     si, path_buf
        mov     cx, 80
        call    print_text
        mov     dx, msg_pn_3
        call    print
        mov     dx, [fail_reason]
        call    print
        mov     dx, msg_gn_3
        jmp     print
.parsed:
        mov     di, prof_new + PT_NAME
        mov     si, prof_spec
        call    copy_upper
        xor     al, al
.slot:
        cmp     al, [prof_npat]
        jae     .slots
        call    prof_load_slot
        inc     al
        jmp     .slot
.slots:
        mov     byte [prof_ok], 1
        mov     al, [prof_default]
        cmp     al, PT_NONE
        je      .ret
        mov     [prof_new + PT_CUR], al
        call    prof_block
        mov     di, pbuf
        mov     cx, PBLK_LEN
        rep     movsb
        mov     al, [pbuf + PB_FLAGS]
        and     al, RBS_PF_LOADED
        mov     [patch_ok], al          ; a default that failed: the faithful voice
        or      word [opt_set], OPT_P
.ret:
        ret

; prof_folder: DI = where to write "<profiles folder>\<NAME>\". Out: DI at its NUL.
prof_folder:
        mov     si, profiles_dir
        call    copy_upper
        mov     byte [di], '\'
        inc     di
        mov     si, prof_spec
        call    copy_upper
        mov     byte [di], '\'
        inc     di
        mov     byte [di], 0
        ret

; prof_block: AL = a slot. Out: SI = its block in prof_new.
prof_block:
        push    ax
        mov     ah, PBLK_LEN
        mul     ah
        add     ax, prof_new + PT_BLOCKS
        mov     si, ax
        pop     ax
        ret

; prof_load_slot: AL = a slot. Loads the patch prof_names holds for it into its block, named
; "PROFILE\PATCH"; one that fails is reported and leaves the block without a patch.
prof_load_slot:
        push    ax
        push    ax
        call    prof_block
        mov     di, si                  ; DI = the block, its name first
        push    di
        mov     si, prof_spec
        call    copy_upper
        mov     byte [di], '\'
        inc     di
        pop     bx                      ; BX = the block
        pop     ax
        mov     ah, PROF_NAME_LEN
        mul     ah
        add     ax, prof_names
        mov     si, ax
        push    si
        call    copy_upper
        mov     di, path_buf
        call    prof_folder
        pop     si
        call    copy_upper
        mov     si, s_ext
        call    copy_upper
        mov     dx, path_buf
        mov     cx, PATCH_FILE_MAX + 1
        call    read_file
        jnc     .parse
        mov     si, r_notfound
        or      al, al
        jz      .failed
        mov     si, r_unread
        jmp     .failed
.parse:
        mov     cx, ax
        mov     si, io_buf
        mov     di, bx
        push    bx
        call    patch_parse
        pop     bx
        jnc     .done
.failed:
        mov     [fail_spec], bx
        mov     word [fail_who], path_buf
        mov     [fail_reason], si
        call    print_not_used
.done:
        pop     ax
        ret

; profiles_resolve: the profiles folder, from PROFILES= as patches_resolve settles PATCHES=. A
; PROFILES= that is not a plain DOS path is reported, and the default folder used.
profiles_resolve:
        mov     si, cfg_profiles
        mov     di, profiles_dir
        mov     bx, s_profiles
        call    dir_resolve
        jnc     .ret
        mov     dx, s_badprofiles
        call    print
        mov     si, cfg_profiles
        mov     cx, 40
        call    print_text
        mov     dx, s_badpatches_2
        call    print
.ret:
        ret

; name_valid: one 8.3 base name, as spec_valid takes a part. In: SI = the text, CX = its length.
; Out: CF clear and spec_buf = the upper-cased ASCIZ name; CF set when it is not one.
; Keeps every register but the flags.
name_valid:
        call    spec_valid
        jc      .ret
        push    ax
        push    si
        mov     si, spec_buf
.next:
        mov     al, [si]
        inc     si
        or      al, al
        jz      .ok                     ; CF clear from the OR
        cmp     al, '\'
        jne     .next
        stc
.ok:
        pop     si
        pop     ax
.ret:
        ret

; ---------------------------------------------------------------- the parser

; profile_parse
; In:  DS:SI = the text, CX = its length
; Out: CF clear: prof_new holds the rules, prof_names and prof_npat the patches they name (in
;      slot order), prof_default the DEFAULT= slot or PT_NONE. The blocks are still empty.
;      CF set: SI -> a '$'-terminated reason.
;      Clobbers AX, BX, CX, DX, SI, DI and ES; shares patch.asm's line state.
profile_parse:
        cld
        mov     [pg_sp], sp
        cmp     cx, PATCH_FILE_MAX
        jbe     .size
        PFAIL   r_size
.size:
        mov     [pf_pos], si
        add     cx, si
        mov     [pf_end], cx
        push    ds
        pop     es
        xor     al, al
        mov     di, prof_new
        mov     cx, PT_LEN
        rep     stosb
        mov     di, prof_names
        mov     cx, PROF_PATCHES * PROF_NAME_LEN
        rep     stosb
        mov     byte [prof_new + PT_LAYOUT], PROF_LAYOUT
        mov     byte [prof_new + PT_ACTIVE], 1
        mov     byte [prof_new + PT_CUR], PT_NONE
        mov     [pg_sec], al
        mov     [pg_seen], al
        mov     [pg_has], al
        mov     [prof_npat], al
        mov     word [pg_rule], 0
        mov     byte [prof_default], PT_NONE
.line:
        call    next_line
        jc      .finish
        call    pg_line
        jmp     .line
.finish:
        call    pg_rule_end
        test    byte [pg_seen], G_PROFILE
        jnz     .profile
        PFAIL   g_noprofile
.profile:
        test    byte [pg_seen], G_FORMAT
        jnz     .done
        PFAIL   g_noformat
.done:
        clc
        ret

; pg_fail: abandon the parse from any depth, back to profile_parse's caller with CF set and SI
; the reason.
pg_fail:
        mov     sp, [pg_sp]
        stc
        ret

; pg_line: one trimmed line, SI, DX.
pg_line:
        cmp     si, dx
        je      .ret
        mov     al, [si]
        cmp     al, ';'
        je      .ret
        cmp     al, '['
        jne     .keyval
        jmp     pg_section
.keyval:
        call    split_kv
        jc      .ret
        mov     al, [pg_sec]
        cmp     al, GS_PROFILE
        jne     .rule
        jmp     pg_profkey
.rule:
        cmp     al, GS_RULE
        jne     .ret
        jmp     pg_rulekey
.ret:
        ret                             ; before any section, or in an unknown one

; pg_section: a '[name]' line, SI, DX. Any section ends the rule before it.
pg_section:
        mov     bx, dx
        cmp     byte [bx - 1], ']'
        jne     .header
        call    pg_rule_end
        inc     si
        dec     dx
        call    trim
        mov     bx, w_psections
        call    find_word
        jnc     .known
        mov     byte [pg_sec], GS_OTHER
        ret
.known:
        or      al, al
        jnz     .rule
        test    byte [pg_seen], G_PROFILE
        jnz     .twice
        or      byte [pg_seen], G_PROFILE
        mov     byte [pg_sec], GS_PROFILE
        ret
.rule:
        mov     byte [pg_sec], GS_RULE
        mov     al, [prof_new + PT_COUNT]
        cmp     al, PROF_RULES
        jb      .room
        PFAIL   g_rules
.room:
        inc     byte [prof_new + PT_COUNT]
        mov     ah, RULE_LEN
        mul     ah
        add     ax, prof_new + PT_RULES
        mov     [pg_rule], ax
        ret
.header:
        PFAIL   r_header
.twice:
        PFAIL   r_secdup

; pg_rule_end: the rule being read, if any, must have a step and a patch.
pg_rule_end:
        mov     bx, [pg_rule]
        or      bx, bx
        jz      .ret
        mov     word [pg_rule], 0
        cmp     byte [bx + RL_STEPS], 0
        jne     .steps
        PFAIL   g_nostep
.steps:
        test    byte [pg_has], 1
        jnz     .patch
        PFAIL   g_nopatch
.patch:
        mov     byte [pg_has], 0
.ret:
        ret

; pg_profkey: a KEY=VALUE of [PROFILE].
pg_profkey:
        mov     bx, w_format
        call    key_is
        jc      .default
        test    byte [pg_seen], G_FORMAT
        jnz     .twice
        call    value_num
        jc      .badformat
        cmp     ax, 1
        jne     .badformat
        or      byte [pg_seen], G_FORMAT
        ret
.default:
        mov     bx, w_default
        call    key_is
        jc      .ret
        test    byte [pg_seen], G_DEFAULT
        jnz     .twice
        or      byte [pg_seen], G_DEFAULT
        call    pg_patch_name
        mov     [prof_default], al
.ret:
        ret
.twice:
        PFAIL   r_keydup
.badformat:
        PFAIL   r_format

; pg_rulekey: a KEY=VALUE of [RULE].
pg_rulekey:
        mov     bx, w_step
        call    key_is
        jc      .patch
        mov     si, [pg_rule]
        mov     al, [si + RL_STEPS]
        cmp     al, PROF_STEPS
        jb      .room
        PFAIL   g_steps
.room:
        inc     byte [si + RL_STEPS]
        call    step_at                 ; DI = the step
        jmp     pg_step
.patch:
        mov     bx, w_patchkey
        call    key_is
        jc      .ret
        test    byte [pg_has], 1
        jnz     .twice
        or      byte [pg_has], 1
        call    pg_patch_name
        mov     bx, [pg_rule]
        mov     [bx + RL_SLOT], al
.ret:
        ret
.twice:
        PFAIL   r_keydup

; pg_step: the value of a STEP= into the step at DI: a kind, then up to two numbers. The rule's
; RL_F_ANY says whether its latest step, so far its last, takes any value.
pg_step:
        mov     ax, [pf_vs]
        mov     [pg_ts], ax
        mov     ax, [pf_ve]
        mov     [pg_te], ax
        call    pg_token
        jc      .bad
        mov     bx, w_kinds
        call    find_word
        jc      .bad
        inc     al                      ; SK_NOTE is 1, in w_kinds' order
        mov     [di + ST_KIND], al
        mov     word [di + ST_LO], 0
        mov     word [di + ST_HI], 0FFFFh
        call    pg_token
        jnc     .value
        or      byte [di + ST_KIND], SK_ANY
        mov     bx, [pg_rule]
        or      byte [bx + RL_FLAGS], RL_F_ANY
        ret
.value:
        mov     bx, [pg_rule]
        and     byte [bx + RL_FLAGS], 0FFh ^ RL_F_ANY
        cmp     byte [di + ST_KIND], SK_OFF
        je      .bad                    ; a note off has no value
        call    get_word
        jc      .bad
        mov     [di + ST_LO], ax
        mov     [di + ST_HI], ax
        cmp     byte [di + ST_KIND], SK_CTRL
        jne     .tolerance
        cmp     ax, 0FFh
        ja      .bad
        jmp     .end                    ; a byte has no tolerance
.tolerance:
        call    pg_token
        jc      .ret
        call    get_word
        jc      .bad
        mov     bx, ax                  ; BX = the tolerance
        mov     ax, [di + ST_LO]
        sub     ax, bx
        jnc     .lo
        xor     ax, ax
.lo:
        mov     [di + ST_LO], ax
        mov     ax, [di + ST_HI]
        add     ax, bx
        jnc     .hi
        mov     ax, 0FFFFh
.hi:
        mov     [di + ST_HI], ax
.end:
        call    pg_token
        jnc     .bad                    ; one number too many
.ret:
        ret
.bad:
        PFAIL   g_step

; pg_token: the next blank-separated token of [pg_ts, pg_te). Out: CF set when there is none;
; otherwise SI, DX = the token. Clobbers AL and BX.
pg_token:
        mov     si, [pg_ts]
        mov     dx, [pg_te]
        call    skip_blank
        cmp     si, dx
        jae     .none
        mov     bx, si
.end:
        cmp     bx, dx
        jae     .got
        mov     al, [bx]
        call    is_blank
        je      .got
        inc     bx
        jmp     .end
.got:
        mov     [pg_ts], bx
        mov     dx, bx
        clc
        ret
.none:
        stc
        ret

; pg_patch_name: the value as a patch of the profile's folder. Out: AL = its slot: the one it
; already has, or the next free one.
pg_patch_name:
        mov     si, [pf_vs]
        mov     cx, [pf_ve]
        sub     cx, si
        call    name_valid
        jnc     .valid
        PFAIL   g_name
.valid:
        mov     dx, [pf_ve]
        mov     bx, prof_names
        xor     al, al
.find:
        cmp     al, [prof_npat]
        jae     .add
        push    ax
        call    span_is
        pop     ax
        jnc     .ret
        add     bx, PROF_NAME_LEN
        inc     al
        jmp     .find
.add:
        cmp     al, PROF_PATCHES
        jb      .room
        PFAIL   g_patches
.room:
        inc     byte [prof_npat]
        push    ax
        mov     di, bx
        mov     si, spec_buf
        call    copy_upper
        pop     ax
.ret:
        ret

; get_word: SI, DX = a span: decimal digits, or hex digits and a trailing H, in any case.
; Out: AX = the value; CF set for an empty span, any other character or a value over FFFFh.
; Keeps BX, CX and DX.
get_word:
        push    bx
        push    cx
        push    di
        mov     di, dx                  ; DI = the end of the digits
        cmp     si, di
        jae     .bad
        mov     cx, 10
        mov     al, [di - 1]
        call    upper
        cmp     al, 'H'
        jne     .digits
        mov     cx, 16
        dec     di
        cmp     si, di
        jae     .bad                    ; an H alone
.digits:
        xor     bx, bx                  ; BX = the value so far
.digit:
        mov     al, [si]
        call    upper
        sub     al, '0'
        cmp     al, 9
        jbe     .have
        sub     al, 'A' - '0' - 10
        cmp     al, 10
        jb      .bad                    ; between '9' and 'A'
.have:
        xor     ah, ah
        cmp     ax, cx
        jae     .bad                    ; not a digit of this base
        push    ax
        push    dx
        mov     ax, bx
        mul     cx
        mov     bx, ax
        or      dx, dx
        pop     dx
        pop     ax
        jnz     .bad
        add     bx, ax
        jc      .bad
        inc     si
        cmp     si, di
        jb      .digit
        mov     ax, bx
        clc
        jmp     .out
.bad:
        stc
.out:
        pop     di
        pop     cx
        pop     bx
        ret

; ---------------------------------------------------------------- data

w_psections     db      "PROFILE", 0, "RULE", 0, 0
w_default       db      "DEFAULT", 0
w_step          db      "STEP", 0
w_kinds         db      "NOTE", 0, "PITCH", 0, "OFF", 0, "CTRL", 0, 0
s_rbg           db      ".RBG", 0
s_badprofiles   db      "PROFILES=$"

msg_gn_1        db      "Profile $"
msg_gn_2        db      " not used: $"
msg_gn_3        db      ".", 13, 10, '$'

g_noprofile     db      "there is no [PROFILE] section$"
g_noformat      db      "[PROFILE] has no FORMAT$"
g_rules         db      "more than 16 rules$"
g_steps         db      "a rule has more than 4 steps$"
g_patches       db      "more than 8 patches$"
g_nostep        db      "a rule has no STEP$"
g_nopatch       db      "a rule has no PATCH$"
g_name          db      "a patch is not 1 to 8 letters, digits, _ or -, and not only digits$"
g_step          db      "a STEP is not NOTE [n [t]], PITCH [n [t]], CTRL [n] or OFF$"

%if PROF_RULES != 16 || PROF_STEPS != 4 || PROF_PATCHES != 8
%error the limits in the reasons above are written out
%endif

prof_ok         db      0               ; 1 when prof_new holds the profile /G: asked for
prof_dst        dw      0               ; the resident table's offset beside RB_STATE, or 0: none
prof_spec       times PROF_NAME_LEN db 0
prof_default    db      PT_NONE
prof_npat       db      0
prof_names      times PROF_PATCHES * PROF_NAME_LEN db 0
profiles_dir    times 192 db 0
pg_sp           dw      0
pg_rule         dw      0               ; the rule being read in prof_new, or 0
pg_ts           dw      0               ; what is left of a STEP value
pg_te           dw      0
pg_sec          db      0
pg_seen         db      0
pg_has          db      0               ; bit 0: the rule being read has its PATCH
prof_new        times PT_LEN db 0
