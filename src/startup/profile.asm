; The startup part's game profiles: /G:NAME reads PROFILES\NAME\NAME.RBG, a text file in the
; .RBP style, into a table of rules (include/profile.inc), and each patch it names from the same
; folder into a slot of that table. apply_fields then copies the table into the resident one.
;   [PROFILE]  FORMAT=1 (required), DEFAULT=NAME (optional: the patch that plays first),
;              NAME=text (optional)
;   [RULE]     STEP=KIND [VALUE [TOLERANCE]], one to four in order, then PATCH=NAME;
;              ID=NAME and WHILE=ID (optional), NAME=text (optional)
;   [EFFECT]   PITCH=DIVISOR [TOLERANCE] and PATCH=NAME (both required); WHILE=ID, NAME=text
;              (optional): up to 8, sharing the 8 patches
; Kinds: NOTE (a note start), CHANGE (a sounding note's new pitch) and PITCH (either) take a
; divisor and a tolerance, CTRL a byte, OFF nothing. A step without a value takes any, except
; OFF, which never has one. A WHILE names the ID of a rule before or after it, itself included;
; it is resolved when the whole file is read. A NAME is 1 to 24 characters without a control
; character: checked, never kept. Numbers are decimal, or hex with a trailing H. Keys, kinds
; and section names in any case; ';' comment lines, blank lines, unknown keys and unknown
; sections are ignored; a duplicate key or [PROFILE] is invalid; at most 2048 bytes.
; 8086. Included after resident_end, so it is freed when going resident. Uses patch.asm's line
; helpers and parser, and files.asm's names, paths and reads.
; SPDX-License-Identifier: MIT

        cpu     8086
%include "profile.inc"
%include "speaker.inc"                  ; DIV_MIN

GS_NONE         equ     0               ; the section a line is in
GS_PROFILE      equ     1
GS_RULE         equ     2
GS_OTHER        equ     3
GS_EFFECT       equ     4
G_PROFILE       equ     01h             ; pg_seen
G_FORMAT        equ     02h
G_DEFAULT       equ     04h
PH_PATCH        equ     01h             ; pg_has: the keys the section being read has had
PH_NAME         equ     02h
PH_ID           equ     04h
PH_WHILE        equ     08h
PH_PITCH        equ     10h
NAME_MAX        equ     24              ; the longest NAME
WHILE_LEN       equ     6               ; a pending WHILE: dw the byte it sets, dw its name's span

%macro PFAIL 1
        mov     si, %1
        jmp     pg_fail
%endmacro

; profile_select: loads the profile prof_spec names into prof_new, and each of its patches into
; a slot. A profile that can't be used is reported and nothing changes (prof_ok = 0). A patch
; that can't be is reported, and its slot plays the faithful voice; an effect that names one is
; dropped. When the profile has a DEFAULT=, its block goes into pbuf and OPT_P is set, as
; load_patch does for PATCH=, so apply_fields plays it. Run inside crit_on. Out: prof_ok.
; Clobbers ES.
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
        call    prof_fx_drop
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

; prof_fx_drop: an effect whose slot's patch did not load is removed from prof_new: the ones
; after it move up, in order, and PT_FXCOUNT falls. Needs ES = DS.
prof_fx_drop:
        mov     si, prof_new + PT_EFFECTS
        mov     di, si                  ; DI = where the next effect kept goes
        mov     cl, [prof_new + PT_FXCOUNT]
        xor     ch, ch
        mov     byte [prof_new + PT_FXCOUNT], 0
        jcxz    .ret
.next:
        mov     al, [si + EF_SLOT]
        push    si
        call    prof_block
        test    byte [si + PB_FLAGS], RBS_PF_LOADED
        pop     si
        jz      .drop
        push    cx
        mov     cx, EFFECT_LEN
        rep     movsb
        pop     cx
        inc     byte [prof_new + PT_FXCOUNT]
        jmp     .more
.drop:
        add     si, EFFECT_LEN
.more:
        loop    .next
.ret:
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
; Out: CF clear: prof_new holds the rules and effects, prof_names and prof_npat the patches they
;      name (in slot order), prof_default the DEFAULT= slot or PT_NONE. The blocks are still
;      empty. The text must stay as it is until the call returns: a WHILE is read from it again
;      once every ID is known.
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
        mov     di, pg_ids
        mov     cx, PROF_RULES * PROF_NAME_LEN
        rep     stosb
        mov     byte [prof_new + PT_LAYOUT], PROF_LAYOUT
        mov     byte [prof_new + PT_ACTIVE], 1
        mov     byte [prof_new + PT_CUR], PT_NONE
        mov     byte [prof_new + PT_FXSLOT], PT_NONE
        mov     [pg_sec], al
        mov     [pg_seen], al
        mov     [pg_has], al
        mov     [prof_npat], al
        mov     word [pg_rule], 0
        mov     word [pg_effect], 0
        mov     word [pg_nwhile], pg_whiles
        mov     byte [prof_default], PT_NONE
.line:
        call    next_line
        jc      .finish
        call    pg_line
        jmp     .line
.finish:
        call    pg_item_end
        test    byte [pg_seen], G_PROFILE
        jnz     .profile
        PFAIL   g_noprofile
.profile:
        test    byte [pg_seen], G_FORMAT
        jnz     .done
        PFAIL   g_noformat
.done:
        call    pg_resolve
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
        jne     .effect
        jmp     pg_rulekey
.effect:
        cmp     al, GS_EFFECT
        jne     .ret
        jmp     pg_effectkey
.ret:
        ret                             ; before any section, or in an unknown one

; pg_section: a '[name]' line, SI, DX. Any section ends the rule or effect before it.
pg_section:
        mov     bx, dx
        cmp     byte [bx - 1], ']'
        jne     .header
        call    pg_item_end
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
        jnz     .item
        test    byte [pg_seen], G_PROFILE
        jnz     .twice
        or      byte [pg_seen], G_PROFILE
        mov     byte [pg_sec], GS_PROFILE
        ret
.item:
        cmp     al, 1
        jne     .effect
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
.effect:
        mov     byte [pg_sec], GS_EFFECT
        mov     al, [prof_new + PT_FXCOUNT]
        cmp     al, PROF_EFFECTS
        jb      .fxroom
        PFAIL   g_effects
.fxroom:
        inc     byte [prof_new + PT_FXCOUNT]
        mov     ah, EFFECT_LEN
        mul     ah
        add     ax, prof_new + PT_EFFECTS
        mov     [pg_effect], ax
        ret
.header:
        PFAIL   r_header
.twice:
        PFAIL   r_secdup

; pg_item_end: the rule or effect being read, if any, must be complete: a rule has a step and a
; patch, an effect a PITCH and a patch. Any section's end clears the keys it had.
pg_item_end:
        mov     bx, [pg_rule]
        or      bx, bx
        jz      .effect
        mov     word [pg_rule], 0
        cmp     byte [bx + RL_STEPS], 0
        jne     .steps
        PFAIL   g_nostep
.steps:
        test    byte [pg_has], PH_PATCH
        jnz     .done
        PFAIL   g_nopatch
.effect:
        cmp     word [pg_effect], 0
        je      .done
        mov     word [pg_effect], 0
        test    byte [pg_has], PH_PITCH
        jnz     .pitch
        PFAIL   g_nopitch
.pitch:
        test    byte [pg_has], PH_PATCH
        jnz     .done
        PFAIL   g_nofxpatch
.done:
        mov     byte [pg_has], 0
        ret

; pg_once: AH = a key's bit. Fails when the section already had the key; otherwise notes it.
pg_once:
        test    [pg_has], ah
        jnz     .twice
        or      [pg_has], ah
        ret
.twice:
        PFAIL   r_keydup

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
        jc      .name
        test    byte [pg_seen], G_DEFAULT
        jnz     .twice
        or      byte [pg_seen], G_DEFAULT
        call    pg_patch_name
        mov     [prof_default], al
        ret
.name:
        jmp     pg_name
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
        jc      .id
        mov     ah, PH_PATCH
        call    pg_once
        call    pg_patch_name
        mov     bx, [pg_rule]
        mov     [bx + RL_SLOT], al
        ret
.id:
        mov     bx, w_id
        call    key_is
        jc      .while
        mov     ah, PH_ID
        call    pg_once
        jmp     pg_id
.while:
        mov     bx, w_while
        call    key_is
        jc      .name
        mov     bx, [pg_rule]
        add     bx, RL_FLAGS
        jmp     pg_while
.name:
        jmp     pg_name

; pg_effectkey: a KEY=VALUE of [EFFECT].
pg_effectkey:
        mov     bx, w_pitch
        call    key_is
        jc      .patch
        mov     ah, PH_PITCH
        call    pg_once
        jmp     pg_pitch
.patch:
        mov     bx, w_patchkey
        call    key_is
        jc      .while
        mov     ah, PH_PATCH
        call    pg_once
        call    pg_patch_name
        mov     bx, [pg_effect]
        mov     [bx + EF_SLOT], al
        ret
.while:
        mov     bx, w_while
        call    key_is
        jc      .name
        mov     bx, [pg_effect]
        add     bx, EF_WHILE
        jmp     pg_while
.name:
        jmp     pg_name

; pg_name: a NAME= of any section: a display name for a menu, later. Only checked, and once
; per section: 1 to NAME_MAX characters, none below 20h or 7Fh. Nothing of it is kept. Any other
; key is ignored.
pg_name:
        mov     bx, w_name
        call    key_is
        jc      .ret
        mov     ah, PH_NAME
        call    pg_once
        mov     si, [pf_vs]
        mov     cx, [pf_ve]
        sub     cx, si
        jz      .bad
        cmp     cx, NAME_MAX
        ja      .bad
.char:
        mov     al, [si]
        inc     si
        cmp     al, 20h
        jb      .bad
        cmp     al, 7Fh
        je      .bad
        loop    .char
.ret:
        ret
.bad:
        PFAIL   g_dispname

; pg_id: the value of an ID= of the rule being read: kept upper-cased, in the rule's place in
; pg_ids, for the WHILEs. No other rule may have it.
pg_id:
        mov     si, [pf_vs]
        mov     cx, [pf_ve]
        sub     cx, si
        call    name_valid
        jnc     .valid
        PFAIL   g_id
.valid:
        mov     si, [pf_vs]
        mov     dx, [pf_ve]
        mov     bx, pg_ids
        mov     cx, PROF_RULES          ; this rule's own place is still empty: it never matches
.same:
        call    span_is
        jnc     .twice
        add     bx, PROF_NAME_LEN
        loop    .same
        mov     al, [prof_new + PT_COUNT]
        dec     al                      ; this rule's number
        mov     ah, PROF_NAME_LEN
        mul     ah
        add     ax, pg_ids
        mov     di, ax
        mov     si, spec_buf
        jmp     copy_upper
.twice:
        PFAIL   g_iddup

; pg_while: the value of a WHILE=. In: BX = the byte its number goes into. Which rule it names is
; settled by pg_resolve, once the whole file is read: it keeps the byte and the value's span.
pg_while:
        mov     ah, PH_WHILE
        call    pg_once
        mov     di, [pg_nwhile]
        mov     [di], bx
        mov     ax, [pf_vs]
        mov     [di + 2], ax
        mov     ax, [pf_ve]
        mov     [di + 4], ax
        add     di, WHILE_LEN
        mov     [pg_nwhile], di
        ret

; pg_resolve: each WHILE is set to (the number of the rule whose ID it names + 1) * 2; one that
; names no rule's ID is refused. A rule without an ID is nobody's.
pg_resolve:
        mov     di, pg_whiles
.while:
        cmp     di, [pg_nwhile]
        jae     .ret
        mov     si, [di + 2]
        mov     dx, [di + 4]
        mov     bx, pg_ids
        xor     cl, cl                  ; CL = the rule tried
.rule:
        cmp     cl, [prof_new + PT_COUNT]
        jae     .none
        cmp     byte [bx], 0
        je      .next
        call    span_is
        jnc     .found
.next:
        add     bx, PROF_NAME_LEN
        inc     cl
        jmp     .rule
.found:
        inc     cl
        shl     cl, 1
        mov     bx, [di]
        or      [bx], cl
        add     di, WHILE_LEN
        jmp     .while
.none:
        PFAIL   g_while
.ret:
        ret

; pg_pitch: the value of a PITCH= into the effect being read: a divisor and a tolerance, as a
; NOTE step takes them. Its lowest divisor must be one the OPL can play.
pg_pitch:
        mov     ax, [pf_vs]
        mov     [pg_ts], ax
        mov     ax, [pf_ve]
        mov     [pg_te], ax
        call    pg_token
        jc      .bad
        call    get_word
        jc      .bad
        mov     di, [pg_effect]
        add     di, EF_LO               ; DI = the range: its lowest divisor, then its highest
        mov     [di], ax
        mov     [di + 2], ax
        call    pg_tolerance
        jc      .bad
        cmp     word [di], DIV_MIN
        jae     .ret
.bad:
        PFAIL   g_pitch
.ret:
        ret

; pg_step: the value of a STEP= into the step at DI: a kind, then up to two numbers. The rule's
; RL_F_ANY says whether its latest step, so far its last, takes any value; OFF never has one,
; so it never does, though its kind keeps SK_ANY (it matches any note stop).
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
        inc     al                      ; SK_NOTE is 1, in w_kinds' order, then CTRL's bit
        cmp     al, 5
        jne     .kind
        mov     al, SK_CTRL
.kind:
        mov     [di + ST_KIND], al
        mov     word [di + ST_LO], 0
        mov     word [di + ST_HI], 0FFFFh
        call    pg_token
        jnc     .value
        or      byte [di + ST_KIND], SK_ANY
        mov     bx, [pg_rule]
        cmp     byte [di + ST_KIND], SK_OFF | SK_ANY
        jne     .any
        and     byte [bx + RL_FLAGS], 0FFh ^ RL_F_ANY
        ret
.any:
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
        call    pg_token
        jnc     .bad                    ; a byte has no tolerance
        ret
.tolerance:
        add     di, ST_LO
        call    pg_tolerance
        jc      .bad
        ret
.bad:
        PFAIL   g_step

; pg_tolerance: DI = a range, its lowest value and then its highest, both a number just read;
; the rest of the value [pg_ts, pg_te) is an optional tolerance and nothing more. The range
; widens by it, stopping at 0 and FFFFh. Out: CF set when the rest is not that. Keeps DI.
pg_tolerance:
        call    pg_token
        jc      .ok
        call    get_word
        jc      .ret
        mov     bx, ax                  ; BX = the tolerance
        mov     ax, [di]
        sub     ax, bx
        jnc     .lo
        xor     ax, ax
.lo:
        mov     [di], ax
        mov     ax, [di + 2]
        add     ax, bx
        jnc     .hi
        mov     ax, 0FFFFh
.hi:
        mov     [di + 2], ax
        call    pg_token
        cmc                             ; another number is one too many
        ret
.ok:
        clc
.ret:
        ret

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

w_psections     db      "PROFILE", 0, "RULE", 0, "EFFECT", 0, 0
w_default       db      "DEFAULT", 0
w_name          db      "NAME", 0
w_id            db      "ID", 0
w_while         db      "WHILE", 0
w_pitch         db      "PITCH", 0
w_step          db      "STEP", 0
w_kinds         db      "NOTE", 0, "CHANGE", 0, "PITCH", 0, "OFF", 0, "CTRL", 0, 0
%if SK_NOTE != 1 || SK_CHANGE != 2 || SK_PITCH != 3 || SK_OFF != 4 || SK_CTRL != 8
%error pg_step takes a kind from its place in w_kinds
%endif
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
g_step          db      "a STEP is not NOTE, CHANGE or PITCH [n [t]], CTRL [n] or OFF$"
g_effects       db      "more than 8 effects$"
g_nopitch       db      "an effect has no PITCH$"
g_nofxpatch     db      "an effect has no PATCH$"
g_pitch         db      "a PITCH is not n [t] with n - t at least 193$"
g_id            db      "an ID is not 1 to 8 letters, digits, _ or -, or only digits$"
g_iddup         db      "two rules have the same ID$"
g_while         db      "a WHILE names no rule's ID$"
g_dispname      db      "a NAME is not 1 to 24 characters$"

%if PROF_RULES != 16 || PROF_STEPS != 4 || PROF_PATCHES != 8 || PROF_EFFECTS != 8 || DIV_MIN != 193
%error the limits in the reasons above are written out
%endif
%if ST_HI != ST_LO + 2 || EF_HI != EF_LO + 2
%error pg_tolerance reads a range as its lowest value, then its highest
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
pg_effect       dw      0               ; the effect being read in prof_new, or 0
pg_ts           dw      0               ; what is left of a STEP or PITCH value
pg_te           dw      0
pg_sec          db      0
pg_seen         db      0
pg_has          db      0               ; PH_*: the keys the section being read has had
pg_ids          times PROF_RULES * PROF_NAME_LEN db 0   ; each rule's ID, upper-cased, or empty
pg_nwhile       dw      0               ; the end of the WHILEs kept in pg_whiles
pg_whiles       times (PROF_RULES + PROF_EFFECTS) * WHILE_LEN db 0
prof_new        times PT_LEN db 0
