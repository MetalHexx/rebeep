; The startup part's files: the program's own folder, the settings file RBSTUDIO.CFG, the
; name rules, the patches and profiles folders and the patch lookup by name. Uses patch.asm's
; parser and line helpers.
; 8086. Included after resident_end, so it is freed when going resident. DS is this module's
; segment. ReBeep only ever reads these files; it never writes the settings file.
; SPDX-License-Identifier: MIT

        cpu     8086

SPEC_MAX        equ     17              ; FOLDER\NAME: 8 + 1 + 8
PATH_MAX        equ     64              ; a PATCHES= value
CFG_MAX         equ     2048            ; the settings file is read this far
CFG_PATCHES_LEN equ     PATH_MAX + 1    ; one more than valid, so a longer value stays invalid
CFG_PATCH_LEN   equ     40

FP_LOADED       equ     0               ; try_cand's answers
FP_MISSING      equ     1
FP_FAILED       equ     2

; find_prog_dir: the folder this program was loaded from. DOS 3 and later keep the program's full
; path in the environment block, after the strings and a word count. Run it before the
; environment is freed.
; Out: prog_dir = ASCIZ with its closing backslash ("C:\REBEEP\"), or "" (the current folder)
; when DOS gives no path. Clobbers ES.
find_prog_dir:
        mov     byte [prog_dir], 0
        mov     es, [2Ch]
        mov     ax, es
        or      ax, ax
        jz      .done
        xor     di, di
        xor     al, al
        mov     cx, 7FFFh               ; an environment is at most 32 KB
.string:
        cmp     [es:di], al             ; an empty string ends the block
        je      .path
        repne   scasb
        jne     .done
        jcxz    .done
        jmp     .string
.path:
        cmp     word [es:di + 1], 1     ; one more string follows: the program's path
        jne     .done
        add     di, 3
        xor     bx, bx                  ; BX = the length that ends with the last backslash
        xor     si, si
.copy:
        mov     al, [es:di]
        or      al, al
        jz      .cut
        cmp     si, 127
        jae     .none                   ; longer than DOS allows: not trusted
        mov     [prog_dir + si], al
        inc     si
        inc     di
        cmp     al, '\'
        je      .sep
        cmp     al, ':'
        jne     .copy
.sep:
        mov     bx, si
        jmp     .copy
.cut:
        mov     byte [prog_dir + bx], 0
        jmp     .done
.none:
        mov     byte [prog_dir], 0
.done:
        push    ds
        pop     es
        ret

; spec_valid: a patch name as /P: and PATCH= take it. In: SI = the text, CX = its length.
; FOLDER\NAME or NAME: each part 1 to 8 of A-Z 0-9 _ -, in any case, with at least one character
; that is not a digit, at most one backslash, 17 characters in all.
; Out: CF clear and spec_buf = the upper-cased ASCIZ spec; CF set when the text is not one.
; Keeps every register but the flags.
spec_valid:
        push    ax
        push    bx
        push    cx
        push    dx
        push    si
        push    di
        mov     di, spec_buf
        cmp     cx, SPEC_MAX
        ja      .bad
        or      cx, cx
        jz      .bad
        xor     bx, bx                  ; BL = characters in this part, BH = 1 once one is no digit
        xor     dx, dx                  ; DL = backslashes
.next:
        mov     al, [si]
        inc     si
        cmp     al, '\'
        je      .sep
        call    upper
        cmp     al, '_'
        je      .letter
        cmp     al, '-'
        je      .letter
        cmp     al, '0'
        jb      .bad
        cmp     al, '9'
        jbe     .char
        cmp     al, 'A'
        jb      .bad
        cmp     al, 'Z'
        ja      .bad
.letter:
        mov     bh, 1
.char:
        inc     bl
        cmp     bl, 8
        ja      .bad
        mov     [di], al
        inc     di
        loop    .next
        or      bh, bh                  ; the last part needs a character that is not a digit
        jz      .bad
        mov     byte [di], 0
        clc
        jmp     .out
.sep:
        inc     dl
        cmp     dl, 1
        ja      .bad                    ; a second backslash
        or      bh, bh
        jz      .bad
        mov     byte [di], '\'
        inc     di
        xor     bx, bx
        loop    .next
.bad:                                   ; also: the text ends on a backslash, so the name is empty
        stc
.out:
        pop     di
        pop     si
        pop     dx
        pop     cx
        pop     bx
        pop     ax
        ret

; path_valid: a PATCHES= value. In: SI = ASCIZ. Out: CF set when it is not a plain DOS path:
; 1 to 64 characters, an optional drive letter and colon, an optional leading backslash, then
; components of 1 to 8 characters and an optional dot with 1 to 3 more (letters, digits and
; _ - $ ~ ! only, so no *, ? or ..), at least one. Keeps every register but the flags.
path_valid:
        push    ax
        push    bx
        push    cx
        push    dx
        push    si
        mov     bx, si
.length:
        cmp     byte [bx], 0
        je      .counted
        inc     bx
        jmp     .length
.counted:
        sub     bx, si
        jz      .bad
        cmp     bx, PATH_MAX
        ja      .bad
        cmp     bx, 2
        jb      .nodrive
        cmp     byte [si + 1], ':'
        jne     .nodrive
        mov     al, [si]
        call    upper
        cmp     al, 'A'
        jb      .bad
        cmp     al, 'Z'
        ja      .bad
        add     si, 2
.nodrive:
        cmp     byte [si], '\'
        jne     .parts
        inc     si
.parts:
        xor     dh, dh                  ; DH = components seen
.part:
        cmp     byte [si], 0
        je      .end
        xor     cx, cx                  ; CL = characters before the dot, CH = after it
        xor     dl, dl                  ; DL = 1 once the dot is seen
.char:
        mov     al, [si]
        or      al, al
        jz      .partend
        cmp     al, '\'
        je      .partend
        inc     si
        cmp     al, '.'
        jne     .plain
        or      dl, dl
        jnz     .bad                    ; a second dot, ".." included
        mov     dl, 1
        jmp     .char
.plain:
        call    dos_char
        jc      .bad
        or      dl, dl
        jnz     .ext
        inc     cl
        jmp     .char
.ext:
        inc     ch
        jmp     .char
.partend:
        or      cl, cl
        jz      .bad
        cmp     cl, 8
        ja      .bad
        or      dl, dl
        jz      .counted_part
        or      ch, ch
        jz      .bad
        cmp     ch, 3
        ja      .bad
.counted_part:
        inc     dh
        cmp     byte [si], 0
        je      .end
        inc     si                      ; the backslash
        jmp     .part
.end:
        or      dh, dh
        jnz     .out                    ; CF is clear from the OR
.bad:
        stc
.out:
        pop     si
        pop     dx
        pop     cx
        pop     bx
        pop     ax
        ret

; dos_char: AL, upper-cased. Out: CF set when it is not a letter, digit or _ - $ ~ !
dos_char:
        call    upper
        cmp     al, '0'
        jb      .punct
        cmp     al, '9'
        jbe     .ok
        cmp     al, 'A'
        jb      .no
        cmp     al, 'Z'
        jbe     .ok
        cmp     al, '_'
        je      .ok
        cmp     al, '~'
        je      .ok
.no:
        stc
        ret
.punct:
        cmp     al, '-'
        je      .ok
        cmp     al, '$'
        je      .ok
        cmp     al, '!'
        jne     .no
.ok:
        clc
        ret

; cfg_parse: the settings file's text, SI = the text, CX = its length. Takes PATCHES=, PATCH=
; and PROFILES=: keys in any case, spaces and tabs around the key and the value trimmed, the
; first occurrence of a key counts, a ';' line is a comment, any other line is ignored.
; Out: cfg_patches, cfg_patch and cfg_profiles = the values (ASCIZ, "" when absent; one that is
; too long for its buffer is cut, and fails its check). Clobbers AX, BX, CX, DX, SI and DI.
cfg_parse:
        mov     byte [cfg_patches], 0
        mov     byte [cfg_patch], 0
        mov     byte [cfg_profiles], 0
        mov     byte [cfg_seen], 0
        mov     [pf_pos], si
        add     cx, si
        mov     [pf_end], cx
.line:
        call    next_line
        jc      .done
        cmp     si, dx
        je      .line
        cmp     byte [si], ';'
        je      .line
        call    split_kv
        jc      .line
        mov     bx, w_patches
        call    key_is
        jc      .single
        mov     al, 1
        mov     di, cfg_patches
        mov     cx, CFG_PATCHES_LEN
        jmp     .take
.single:
        mov     bx, w_patchkey
        call    key_is
        jc      .profiles
        mov     al, 2
        mov     di, cfg_patch
        mov     cx, CFG_PATCH_LEN
        jmp     .take
.profiles:
        mov     bx, w_profiles
        call    key_is
        jc      .line
        mov     al, 4
        mov     di, cfg_profiles
        mov     cx, CFG_PATCHES_LEN
.take:
        test    [cfg_seen], al
        jnz     .line                   ; the first occurrence counts
        or      [cfg_seen], al
        mov     si, [pf_vs]
        mov     dx, [pf_ve]
.store:
        cmp     si, dx
        jae     .term
        or      cx, cx
        jz      .term
        mov     al, [si]
        inc     si
        mov     [di], al
        inc     di
        dec     cx
        jmp     .store
.term:
        mov     byte [di], 0
        jmp     .line
.done:
        ret

; asciz_len: SI = ASCIZ. Out: CX = its length.
asciz_len:
        push    si
        xor     cx, cx
.next:
        cmp     byte [si], 0
        je      .done
        inc     si
        inc     cx
        jmp     .next
.done:
        pop     si
        ret

; copy_upper: SI = ASCIZ, copied upper-cased to DI, which stops on the NUL it writes, so
; the next copy appends. Needs DF clear.
copy_upper:
        lodsb
        call    upper
        mov     [di], al
        or      al, al
        jz      .done
        inc     di
        jmp     copy_upper
.done:
        ret

; starts_with: SI = text, BX = an ASCIZ prefix. Out: ZF set when the text starts with it.
starts_with:
        push    si
        push    bx
.next:
        mov     al, [bx]
        or      al, al
        jz      .out                    ; the prefix is used up: ZF set
        cmp     al, [si]
        jne     .out
        inc     si
        inc     bx
        jmp     .next
.out:
        pop     bx
        pop     si
        ret

; patches_resolve: settles the patches folder from cfg_patches and prog_dir into patches_dir
; (upper case, no closing backslash): PATCHES= when it is a plain DOS path, a relative one
; counted from the program's folder, otherwise <program folder>\PATCHES.
; Out: CF set when a PATCHES= was given and is not a plain DOS path (the default is used);
; patches_explicit = 1 when PATCHES= is the folder. Clobbers ES.
patches_resolve:
        mov     si, cfg_patches
        mov     di, patches_dir
        mov     bx, s_patches
        call    dir_resolve
        mov     [patches_explicit], al
        ret

; dir_resolve: a folder setting. In: SI = its value (ASCIZ, "" when absent), DI = where the
; folder goes, BX = the default folder's name beside the program. Out: as patches_resolve, with
; AL = 1 when the value is the folder, 0 for the default. Clobbers ES.
dir_resolve:
        push    ds
        pop     es
        cld
        mov     dx, di
        cmp     byte [si], 0
        je      .default
        call    path_valid
        jc      .invalid
        cmp     byte [si + 1], ':'
        je      .value                  ; a drive: absolute
        cmp     byte [si], '\'
        je      .value
        push    si
        mov     si, prog_dir
        call    copy_upper
        pop     si
.value:
        call    copy_upper
        mov     al, 1
        jmp     .tidy
.invalid:
        call    .default
        stc
        ret
.default:
        mov     di, dx
        mov     si, prog_dir
        call    copy_upper
        mov     si, bx
        call    copy_upper
        xor     al, al
.tidy:
        cmp     byte [di - 1], '\'
        jne     .done
        mov     byte [di - 1], 0
.done:
        clc
        ret

; crit_on: while the startup part reads files, INT 24h fails the call (AL = 3, DOS 3 and later), as
; the studio's handler does: a PATCHES= path on a drive with no disk is "not found", not an
; "Abort, Retry, Fail?" prompt. crit_off puts the old handler back; run it before ReBeep exits or
; goes resident. Both keep every register but the flags.
crit_on:
        push    ax
        push    bx
        push    dx
        push    es
        mov     ax, 3524h
        int     21h
        mov     [old24], bx
        mov     [old24 + 2], es
        mov     dx, crit_fail
        mov     ax, 2524h
        int     21h
        pop     es
        pop     dx
        pop     bx
        pop     ax
        ret

crit_off:
        push    ax
        push    dx
        push    ds
        lds     dx, [old24]
        mov     ax, 2524h
        int     21h
        pop     ds
        pop     dx
        pop     ax
        ret

crit_fail:
        mov     al, 3
        iret

; dir_exists: DX = an ASCIZ path. Out: CF clear when it is a folder.
dir_exists:
        mov     ax, 4300h
        int     21h
        jc      .no
        test    cl, 10h
        jnz     .yes
.no:
        stc
        ret
.yes:
        clc
        ret

; read_file: DX = an ASCIZ path, CX = the most bytes wanted, read into io_buf.
; Out: CF clear and AX = the bytes read; CF set and AL = 0 when the file can't be opened,
; 1 when it can't be read.
read_file:
        push    bx
        mov     ax, 3D00h
        int     21h
        jc      .noopen
        mov     bx, ax
        mov     dx, io_buf
        mov     ah, 3Fh
        int     21h
        jc      .unread
        push    ax
        mov     ah, 3Eh
        int     21h
        pop     ax
        clc
        jmp     .out
.unread:
        mov     ah, 3Eh
        int     21h
        mov     al, 1
        stc
        jmp     .out
.noopen:
        xor     al, al
        stc
.out:
        pop     bx
        ret

; settings_ensure: reads RBSTUDIO.CFG beside the program, once, and settles the patches folder.
; A missing file is no error. A bad PATCHES= is reported and the default folder used. A
; PATCHES= folder that does not exist is noted in patches_missing for find_patch's message.
; Clobbers ES.
settings_ensure:
        cmp     byte [settings_done], 0
        jne     .ret
        mov     byte [settings_done], 1
        push    ds
        pop     es
        cld
        mov     di, path_buf
        mov     si, prog_dir
        call    copy_upper
        mov     si, s_cfg
        call    copy_upper
        mov     dx, path_buf
        mov     cx, CFG_MAX
        call    read_file
        jc      .nofile
        mov     cx, ax
        mov     si, io_buf
        call    cfg_parse
.nofile:
        call    patches_resolve
        jnc     .folder
        mov     dx, s_badpatches_1
        mov     ah, 09h
        int     21h
        mov     si, cfg_patches
        mov     cx, 40
        call    print_text
        mov     dx, s_badpatches_2
        mov     ah, 09h
        int     21h
.folder:
        cmp     byte [patches_explicit], 0
        je      .ret
        mov     dx, patches_dir
        call    dir_exists
        jnc     .ret
        mov     byte [patches_missing], 1
.ret:
        ret

; print_text: SI = ASCIZ, CX = the most characters. Prints it with anything that is not a
; printable ASCII character shown as '?': the text comes from a file or the command line.
; Keeps every register but the flags.
print_text:
        push    ax
        push    cx
        push    dx
        push    si
.next:
        lodsb
        or      al, al
        jz      .done
        cmp     al, ' '
        jb      .odd
        cmp     al, 7Eh
        jbe     .show
.odd:
        mov     al, '?'
.show:
        mov     dl, al
        mov     ah, 02h
        int     21h
        loop    .next
.done:
        pop     si
        pop     dx
        pop     cx
        pop     ax
        ret

; find_patch: loads the patch spec_buf names. FOLDER\NAME is that file alone (FACTORY is
; beside the program, any other folder is under the patches folder); a bare NAME is USER\NAME,
; then FACTORY\NAME, and the first file that exists decides. Needs the settings read first
; for a folder other than FACTORY (settings_ensure).
; Out: CF clear: pbuf = the name field and the patch block. CF set: fail_who (0, or an ASCIZ
; to print before the reason) and fail_reason (a '$' string) say why. Clobbers ES.
find_patch:
        push    ds
        pop     es
        cld
        mov     si, spec_buf
.scan:
        lodsb
        or      al, al
        jz      .bare
        cmp     al, '\'
        jne     .scan
        mov     word [fail_who], 0
        mov     word [fail_reason], r_notfound
        mov     di, cand_name           ; the spec is the candidate
        mov     si, spec_buf
        call    copy_upper
        call    try_cand
        cmp     al, FP_FAILED
        jne     .tried
        mov     word [fail_who], 0      ; the spec already says which file
        jmp     .failed
.bare:
        mov     word [fail_who], 0
        mov     word [fail_reason], r_notfound2
        mov     di, cand_name
        mov     si, s_user
        call    copy_upper
        mov     si, spec_buf
        call    copy_upper
        call    try_cand
        cmp     al, FP_MISSING
        jne     .tried
        mov     di, cand_name
        mov     si, s_factory
        call    copy_upper
        mov     si, spec_buf
        call    copy_upper
        call    try_cand
.tried:
        cmp     al, FP_LOADED
        je      .loaded
        cmp     al, FP_FAILED
        je      .failed
        cmp     byte [patches_missing], 0
        je      .failed
        mov     si, spec_buf            ; a FACTORY patch is never looked for in the patches folder
        mov     bx, s_factory
        call    starts_with
        je      .failed
        mov     word [fail_who], patches_dir
        mov     word [fail_reason], r_nofolder
.failed:
        stc
        ret
.loaded:
        clc
        ret

; try_cand: loads the file cand_name ("FOLDER\NAME") names.
; Out: AL = FP_LOADED (pbuf filled), FP_MISSING (no such file) or FP_FAILED (fail_who and
; fail_reason say why: the file is there but unreadable or not a patch).
try_cand:
        mov     di, path_buf
        mov     si, cand_name
        mov     bx, s_factory
        call    starts_with
        jne     .patches
        mov     si, prog_dir
        call    copy_upper
        jmp     .name
.patches:
        mov     si, patches_dir
        call    copy_upper
        mov     byte [di], '\'
        inc     di
.name:
        mov     si, cand_name
        call    copy_upper
        mov     si, s_ext
        call    copy_upper
        mov     dx, path_buf
        mov     cx, PATCH_FILE_MAX + 1
        call    read_file
        jnc     .parse
        or      al, al
        jnz     .unread
        mov     al, FP_MISSING
        ret
.unread:
        mov     word [fail_reason], r_unread
        jmp     .failed
.parse:
        mov     cx, ax
        mov     si, io_buf
        mov     di, pbuf
        call    patch_parse
        jnc     .good
        mov     [fail_reason], si
.failed:
        mov     word [fail_who], cand_name
        mov     al, FP_FAILED
        ret
.good:
        mov     di, pbuf                ; the name field, zero padded
        mov     cx, 18
        xor     al, al
        rep     stosb
        mov     di, pbuf
        mov     si, cand_name
        call    copy_upper
        mov     al, FP_LOADED
        ret

; ---------------------------------------------------------------- data

s_user          db      "USER\", 0
s_factory       db      "FACTORY\", 0
s_patches       db      "PATCHES", 0
s_cfg           db      "RBSTUDIO.CFG", 0
s_ext           db      ".RBP", 0
w_patches       db      "PATCHES", 0
w_patchkey      db      "PATCH", 0
s_profiles:                             ; the folder's default name and the settings key
w_profiles      db      "PROFILES", 0

s_badpatches_1  db      "PATCHES=$"
s_badpatches_2  db      " ignored: not a plain DOS path. Using the default folder.", 13, 10, '$'

r_notfound      db      "not found$"
r_notfound2     db      "not found in USER or FACTORY$"
r_nofolder      db      "folder does not exist$"
r_unread        db      "cannot be read$"

prog_dir        times 128 db 0
patches_dir     times 192 db 0
path_buf        times 216 db 0
cand_name       times 18 db 0
spec_buf        times 18 db 0
cfg_patches     times CFG_PATCHES_LEN + 1 db 0
cfg_patch       times CFG_PATCH_LEN + 1 db 0
cfg_profiles    times CFG_PATCHES_LEN + 1 db 0
cfg_seen        db      0
patches_explicit db     0
patches_missing db      0
settings_done   db      0
old24           dd      0               ; INT 24h as crit_on found it
fail_who        dw      0
fail_reason     dw      0
pbuf            times PBLK_LEN db 0
io_buf          times PATCH_FILE_MAX + 1 db 0
