/* SPDX-License-Identifier: MIT */
#include <conio.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "log.h"
#include "opl.h"

#define PORT_ADDR1 0x388
#define PORT_ADDR2 0x38A

#define REG_TIMER1 0x02
#define REG_TIMCTL 0x04
#define REG_TEST 0x01
#define REG_PAIRS 0x104
#define REG_NEW 0x105
#define REG_FNUMLO 0xA0
#define REG_KEYBLK 0xB0
#define REG_FBCNT 0xC0
#define REG_KSLTL 0x40
#define KEY_ON 0x20
#define OPL3_OUT 0x30
#define PAIRS_ALL 0x3F

#define SLOTS_MAX 18

/* Status reads after each write, as opl.asm does: after the index write, after the data write. */
#define OPL2_IDX_READS 6
#define OPL2_DATA_READS 35
#define OPL3_IDX_READS 2
#define OPL3_DATA_READS 2

void (*opl_sink)(unsigned reg, unsigned char val);

/* C to B at block 4 of a 49716 Hz chip, F = f * 2^16 / 49716. A note's block is its octave, so note 0 is C0. */
static const unsigned fnum_tab[12] = {345, 365, 387, 410, 435, 460, 488, 517, 547, 580, 615, 651};
static const unsigned char op_off[9] = {0, 1, 2, 8, 9, 10, 16, 17, 18};
static const unsigned char pair_ch[6] = {0, 1, 2, 9, 10, 11};
static const unsigned char ksl_bits[4] = {0, 2, 1, 3};
static const unsigned reg_base[5] = {0x20, 0x40, 0x60, 0x80, 0xE0};

static int idx_reads = OPL2_IDX_READS;
static int data_reads = OPL2_DATA_READS;

static int chip;
static int cur_ops = 2;
static int have_voice;
static int octave = 4;
static Voice voice;

static struct {
    int note;               /* -1 when free */
    unsigned char keyblk;   /* block and F-number high bits: B0h without the key bit */
    unsigned long stamp;    /* order of starting, to find the oldest */
} slot[SLOTS_MAX];
static unsigned long clock_ticks;

static void hw_write(unsigned reg, unsigned char val)
{
    unsigned port = (reg & 0x100) ? PORT_ADDR2 : PORT_ADDR1;
    int i;

    outp(port, reg & 0xFF);
    for (i = 0; i < idx_reads; i++) inp(PORT_ADDR1);
    outp(port + 1, val);
    for (i = 0; i < data_reads; i++) inp(PORT_ADDR1);
}

static void opl_write(unsigned reg, unsigned char val)
{
    log_trace("OPL %03X=%02X", reg, (unsigned)val);
    if (opl_sink != NULL) opl_sink(reg, val);
    else hw_write(reg, val);
}

static void reset_timers(void)
{
    hw_write(REG_TIMCTL, 0x60);
    hw_write(REG_TIMCTL, 0x80);
}

int opl_detect(void)
{
    int i;
    unsigned status;

    reset_timers();
    if (inp(PORT_ADDR1) & 0xE0) return 0;
    hw_write(REG_TIMER1, 0xFF);
    hw_write(REG_TIMCTL, 0x21);
    for (i = 0; i < 200; i++) inp(PORT_ADDR1);
    status = (unsigned)inp(PORT_ADDR1) & 0xE0;
    reset_timers();
    if (status != 0xC0) return 0;
    if (inp(PORT_ADDR1) & 0x06) {
        idx_reads = OPL2_IDX_READS;
        data_reads = OPL2_DATA_READS;
        return 2;
    }
    idx_reads = OPL3_IDX_READS;
    data_reads = OPL3_DATA_READS;
    return 3;
}

void opl_card(char *buf, unsigned len)
{
    static const char *const names[] = {"Sound Blaster", "Sound Blaster", "Sound Blaster Pro", "Sound Blaster 2.0",
                                        "Sound Blaster Pro 2"};
    char text[48];
    const char *env = getenv("BLASTER");
    const char *name = "Sound Blaster";
    long port = -1;
    int type = 0;

    if (len == 0) return;
    buf[0] = '\0';
    if (env == NULL || *env == '\0') return;
    while (*env != '\0') {
        char c;

        while (*env == ' ' || *env == '\t') env++;
        if (*env == '\0') break;
        c = *env++;
        if (c >= 'a' && c <= 'z') c = (char)(c - 'a' + 'A');
        if (c == 'A') port = strtol(env, NULL, 16);
        else if (c == 'T') type = atoi(env);
        while (*env != '\0' && *env != ' ' && *env != '\t') env++;
    }
    if (type >= 1 && type <= 4) name = names[type];
    else if (type == 6) name = "Sound Blaster 16";
    if (port >= 0) sprintf(text, "%s at %lXh", name, port);
    else strcpy(text, name);
    strncpy(buf, text, len - 1);
    buf[len - 1] = '\0';
}

static void op_regs(const Op *o, int chip_kind, unsigned char out[5])
{
    const unsigned char *p = o->v;

    out[0] = (unsigned char)((p[P_TREM] & 1) << 7 | (p[P_VIB] & 1) << 6 | (p[P_SUS] & 1) << 5 | (p[P_KSR] & 1) << 4 |
                             (p[P_MULT] & 15));
    out[1] = (unsigned char)(ksl_bits[p[P_KSL] & 3] << 6 | (63 - (p[P_OL] & 63)));
    out[2] = (unsigned char)((p[P_AR] & 15) << 4 | (p[P_DR] & 15));
    out[3] = (unsigned char)((15 - (p[P_SL] & 15)) << 4 | (p[P_RR] & 15));
    out[4] = (unsigned char)(p[P_WAVE] & (chip_kind == 2 ? 3 : 7));
}

void opl_regs2(const Voice *v, int chip_kind, unsigned char rec[11])
{
    unsigned char m[5];
    unsigned char c[5];
    int r;

    op_regs(&v->op[0], chip_kind, m);
    op_regs(&v->op[1], chip_kind, c);
    for (r = 0; r < 5; r++) {
        rec[r * 2] = m[r];
        rec[r * 2 + 1] = c[r];
    }
    rec[10] = (unsigned char)((v->fb & 7) * 2 + (v->conn ? 1 : 0));
}

void opl_regs4(const Voice *v, int chip_kind, unsigned char rec[22])
{
    unsigned char o[4][5];
    int i;
    int r;

    for (i = 0; i < 4; i++) op_regs(&v->op[i], chip_kind, o[i]);
    for (r = 0; r < 5; r++)
        for (i = 0; i < 4; i++) rec[r * 4 + i] = o[i][r];
    rec[20] = (unsigned char)((v->fb & 7) * 2 + (v->conn & 1));
    rec[21] = (unsigned char)((v->conn >> 1) & 1);
}

/* Registers by channel: 0..8 are bank 0, 9..17 bank 1. */
static unsigned ch_reg(unsigned base, int ch)
{
    return base + (ch >= 9 ? 0x100 : 0) + (unsigned)(ch % 9);
}

static unsigned op_reg(unsigned base, int ch, int carrier)
{
    return base + (ch >= 9 ? 0x100 : 0) + op_off[ch % 9] + (carrier ? 3 : 0);
}

static int phys_count(void)
{
    return chip == 3 ? 18 : 9;
}

static int slot_count(void)
{
    if (chip == 0) return 0;
    if (cur_ops == 4) return chip == 3 ? 6 : 0;
    return phys_count();
}

static int slot_ch(int s)
{
    return cur_ops == 4 ? pair_ch[s] : s;
}

static void key_slot(int s, int on)
{
    opl_write(ch_reg(REG_KEYBLK, slot_ch(s)), (unsigned char)(slot[s].keyblk | (on ? KEY_ON : 0)));
}

static void clear_slots(void)
{
    int i;

    for (i = 0; i < SLOTS_MAX; i++) {
        slot[i].note = -1;
        slot[i].keyblk = 0;
        slot[i].stamp = 0;
    }
}

static unsigned char out_bits(void)
{
    return chip == 3 ? OPL3_OUT : 0;
}

static void program_ops(int ch, const unsigned char *regs, int stride)
{
    int r;

    for (r = 0; r < 5; r++) {
        opl_write(op_reg(reg_base[r], ch, 0), regs[r * stride]);
        opl_write(op_reg(reg_base[r], ch, 1), regs[r * stride + 1]);
    }
}

static void program_all(void)
{
    unsigned char rec[22];
    int i;

    if (cur_ops == 4) {
        opl_regs4(&voice, chip, rec);
        for (i = 0; i < 6; i++) {
            int ch = pair_ch[i];

            program_ops(ch, rec, 4);
            program_ops(ch + 3, rec + 2, 4);
            opl_write(ch_reg(REG_FBCNT, ch), (unsigned char)(rec[20] | out_bits()));
            opl_write(ch_reg(REG_FBCNT, ch + 3), (unsigned char)(rec[21] | out_bits()));
        }
        return;
    }
    opl_regs2(&voice, chip, rec);
    for (i = 0; i < phys_count(); i++) {
        program_ops(i, rec, 2);
        opl_write(ch_reg(REG_FBCNT, i), (unsigned char)(rec[10] | out_bits()));
    }
}

/* Every physical channel off, whatever the pairing, and every slot free. */
static void keys_off_all(void)
{
    int i;

    for (i = 0; i < phys_count(); i++) opl_write(ch_reg(REG_KEYBLK, i), 0);
    clear_slots();
}

void opl_init(int kind)
{
    chip = 0;
    cur_ops = 2;
    have_voice = 0;
    clock_ticks = 0;
    if (kind != 2 && kind != 3) return;
    chip = kind;
    idx_reads = kind == 3 ? OPL3_IDX_READS : OPL2_IDX_READS;
    data_reads = kind == 3 ? OPL3_DATA_READS : OPL2_DATA_READS;
    opl_write(REG_TEST, 0x20);
    if (kind == 3) {
        opl_write(REG_NEW, 0x01);
        opl_write(REG_PAIRS, 0x00);
    }
    keys_off_all();
}

int opl_chip(void)
{
    return chip;
}

void opl_shutdown(void)
{
    int i;

    if (chip == 0) return;
    keys_off_all();
    for (i = 0; i < phys_count(); i++) opl_write(op_reg(REG_KSLTL, i, 1), 63);
    if (chip == 3) {
        opl_write(REG_PAIRS, 0x00);
        opl_write(REG_NEW, 0x00);
    }
    chip = 0;
    have_voice = 0;
}

void opl_set_voice(const Voice *v, int ops, int oct)
{
    if (chip == 0) return;
    ops = ops == 4 ? 4 : 2;
    voice = *v;
    octave = oct < 0 ? 0 : oct > 7 ? 7 : oct;
    have_voice = 1;
    if (ops != cur_ops) {
        if (chip == 3) {
            keys_off_all();
            opl_write(REG_PAIRS, ops == 4 ? PAIRS_ALL : 0x00);
        } else {
            int i;

            for (i = 0; i < SLOTS_MAX; i++) {
                if (slot[i].note >= 0) {
                    key_slot(i, 0);
                    slot[i].note = -1;
                }
            }
        }
        cur_ops = ops;
    }
    if (slot_count() == 0) return;
    program_all();
}

static void pitch(int note, int *block, unsigned *fnum)
{
    int b = note / 12 + octave - 4;
    unsigned f = fnum_tab[note % 12];

    if (b < 0) {
        f >>= -b;
        b = 0;
    } else if (b > 7) {
        f <<= b - 7;
        if (f > 1023) f = 1023;
        b = 7;
    }
    *block = b;
    *fnum = f;
}

int opl_note_on(int note)
{
    int n = slot_count();
    int pick = -1;
    int block;
    unsigned fnum;
    int i;

    if (n == 0 || !have_voice || note < 0 || note >= OPL_NOTES) return -1;
    for (i = 0; i < n; i++)
        if (slot[i].note == note) return i;
    for (i = 0; i < n; i++) {
        if (slot[i].note < 0) {
            pick = i;
            break;
        }
    }
    if (pick < 0) {
        pick = 0;
        for (i = 1; i < n; i++)
            if (slot[i].stamp < slot[pick].stamp) pick = i;
        key_slot(pick, 0);
    }
    pitch(note, &block, &fnum);
    slot[pick].note = note;
    slot[pick].stamp = ++clock_ticks;
    slot[pick].keyblk = (unsigned char)(block << 2 | fnum >> 8);
    opl_write(ch_reg(REG_FNUMLO, slot_ch(pick)), (unsigned char)(fnum & 0xFF));
    key_slot(pick, 1);
    return pick;
}

void opl_note_off(int note)
{
    int n = slot_count();
    int i;

    for (i = 0; i < n; i++) {
        if (slot[i].note == note) {
            key_slot(i, 0);
            slot[i].note = -1;
            return;
        }
    }
}

void opl_all_off(void)
{
    int n = slot_count();
    int i;

    for (i = 0; i < n; i++) {
        key_slot(i, 0);
        slot[i].note = -1;
    }
}
