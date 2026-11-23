/* SUITE: OPL2 */
/* The OPL driver: detection, the register mapping (the factory patches must give the game's old built-in bytes),
   two- and four-operator programming, slot allocation, octave shifts, shutdown, tracing and the jingle. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "testlib.h"
#include "../../src/studio/jingle.h"
#include "../../src/studio/log.h"
#include "../../src/studio/opl.h"
#include "../../src/studio/patch.h"

static unsigned char shadow[512];
static int writes;
static int keyed_at_pairs;   /* channels still keyed when 104h was last written */
static unsigned max_reg;

static int keyed_count(void)
{
    int i;
    int n = 0;

    for (i = 0; i < 9; i++) {
        if (shadow[0xB0 + i] & 0x20) n++;
        if (shadow[0x1B0 + i] & 0x20) n++;
    }
    return n;
}

static void sink(unsigned reg, unsigned char val)
{
    shadow[reg] = val;
    writes++;
    if (reg > max_reg) max_reg = reg;
    if (reg == 0x104) keyed_at_pairs = keyed_count();
}

static void fresh(void)
{
    memset(shadow, 0, sizeof shadow);
    writes = 0;
    max_reg = 0;
    keyed_at_pairs = -1;
}

static unsigned fnum_of(int ch)
{
    return shadow[0xA0 + ch] | (unsigned)(shadow[0xB0 + ch] & 3) << 8;
}

static int block_of(int ch)
{
    return (shadow[0xB0 + ch] >> 2) & 7;
}

/* Operators with distinct values; every field stays within its limit. */
static Voice make_voice(int conn, int fb)
{
    Voice v;
    int i;

    memset(&v, 0, sizeof v);
    v.conn = (unsigned char)conn;
    v.fb = (unsigned char)fb;
    for (i = 0; i < 4; i++) {
        v.op[i].v[P_AR] = (unsigned char)(i + 1);
        v.op[i].v[P_DR] = (unsigned char)(i + 2);
        v.op[i].v[P_SL] = (unsigned char)(i + 3);
        v.op[i].v[P_RR] = (unsigned char)(i + 4);
        v.op[i].v[P_OL] = (unsigned char)(10 + i);
        v.op[i].v[P_MULT] = (unsigned char)(i + 5);
    }
    return v;
}

static void check_factory(const char *file, const unsigned char *want)
{
    char path[40];
    char err[80];
    Patch p;
    unsigned char rec[11];
    int i;

    sprintf(path, "FACTORY\\%s", file);
    t_case(file);
    t_checkl(patch_read(path, &p, err, sizeof err), 0, "the file parses");
    opl_regs2(&p.v2, 3, rec);
    for (i = 0; i < 11; i++) t_checkl(rec[i], want[i], "record byte");
    opl_regs2(&p.v2, 2, rec);
    t_checkl(memcmp(rec, want, 11), 0, "the same record as an OPL2");
}

static void test_factory(void)
{
    static const unsigned char organ[11] = {0x22, 0x21, 0x18, 0x08, 0xF0, 0xF0, 0x0C, 0x0C, 0x00, 0x00, 0x01};
    static const unsigned char flute[11] = {0x21, 0x21, 0x28, 0x00, 0xB0, 0xC0, 0x0A, 0x0A, 0x00, 0x00, 0x00};
    static const unsigned char brass[11] = {0x21, 0x21, 0x10, 0x00, 0xE0, 0xF0, 0x0B, 0x0B, 0x00, 0x00, 0x0A};
    static const unsigned char bell[11] = {0x23, 0x21, 0x20, 0x00, 0xF0, 0xF4, 0x2A, 0x2A, 0x00, 0x00, 0x00};

    check_factory("ORGAN.RBP", organ);
    check_factory("FLUTE.RBP", flute);
    check_factory("BRASS.RBP", brass);
    check_factory("BELL.RBP", bell);
}

static void test_mapping(void)
{
    Voice v = make_voice(0, 0);
    unsigned char rec[11];
    unsigned char rec4[22];

    t_case("Output Level and KSL map to 40h");
    v.op[0].v[P_OL] = 0;
    v.op[1].v[P_OL] = 63;
    v.op[0].v[P_KSL] = 0;
    v.op[1].v[P_KSL] = 1;
    opl_regs2(&v, 3, rec);
    t_checkl(rec[2], 0x3F, "OL 0 is TL 63, KSL 0");
    t_checkl(rec[3], 0x80, "OL 63 is TL 0, KSL 1 is bits 10");
    v.op[0].v[P_KSL] = 2;
    v.op[1].v[P_KSL] = 3;
    opl_regs2(&v, 3, rec);
    t_checkl(rec[2] & 0xC0, 0x40, "KSL 2 is bits 01");
    t_checkl(rec[3] & 0xC0, 0xC0, "KSL 3 is bits 11");

    t_case("20h, 60h and 80h bits");
    memset(v.op[0].v, 0, P_COUNT);
    v.op[0].v[P_TREM] = 1;
    v.op[0].v[P_VIB] = 1;
    v.op[0].v[P_SUS] = 1;
    v.op[0].v[P_KSR] = 1;
    v.op[0].v[P_MULT] = 15;
    v.op[0].v[P_AR] = 15;
    v.op[0].v[P_DR] = 1;
    v.op[0].v[P_SL] = 15;
    v.op[0].v[P_RR] = 2;
    opl_regs2(&v, 3, rec);
    t_checkl(rec[0], 0xFF, "TREM VIB SUS KSR MULT");
    t_checkl(rec[4], 0xF1, "AR DR");
    t_checkl(rec[6], 0x02, "SL 15 is 0, RR");
    v.op[0].v[P_SL] = 0;
    opl_regs2(&v, 3, rec);
    t_checkl(rec[6], 0xF2, "SL 0 is F");

    t_case("the waveform is masked on an OPL2 only");
    v.op[1].v[P_WAVE] = 7;
    opl_regs2(&v, 2, rec);
    t_checkl(rec[9], 3, "OPL2");
    opl_regs2(&v, 3, rec);
    t_checkl(rec[9], 7, "OPL3");

    t_case("two-operator C0h");
    v = make_voice(1, 5);
    opl_regs2(&v, 3, rec);
    t_checkl(rec[10], 0x0B, "feedback 5, AM");

    t_case("four-operator record");
    v = make_voice(0, 3);
    opl_regs4(&v, 3, rec4);
    t_checkl(rec4[0], 0x05, "20h op1");
    t_checkl(rec4[3], 0x08, "20h op4");
    t_checkl(rec4[5], 63 - 11, "40h op2 is 63 - OL");
    t_checkl(rec4[8], 0x12, "60h op1");
    t_checkl(rec4[14], (15 - 5) * 16 + 6, "80h op3");
    t_checkl(rec4[20], 6, "C0h first: FB*2, FM");
    t_checkl(rec4[21], 0, "C0h second: FM");
    v.conn = 1;
    opl_regs4(&v, 3, rec4);
    t_checkl(rec4[20], 7, "AM-FM: CNT1 set");
    t_checkl(rec4[21], 0, "AM-FM: CNT2 clear");
    v.conn = 2;
    opl_regs4(&v, 3, rec4);
    t_checkl(rec4[20], 6, "FM-AM: CNT1 clear");
    t_checkl(rec4[21], 1, "FM-AM: CNT2 set");
    v.conn = 3;
    opl_regs4(&v, 3, rec4);
    t_checkl(rec4[20], 7, "AM-AM: CNT1");
    t_checkl(rec4[21], 1, "AM-AM: CNT2");
}

static void test_four_op(void)
{
    Voice v = make_voice(2, 4);
    unsigned char rec[22];
    int p;
    int r;

    t_case("a four-operator voice programs the six pairs");
    fresh();
    opl_sink = sink;
    opl_init(3);
    opl_set_voice(&v, 4, 4);
    opl_regs4(&v, 3, rec);
    t_checkl(shadow[0x104], 0x3F, "all six pairs enabled");
    t_checkl(shadow[0x105], 1, "OPL3 mode on");
    for (p = 0; p < 6; p++) {
        unsigned b = p < 3 ? 0 : 0x100;
        unsigned m = (unsigned)(p % 3);

        for (r = 0; r < 5; r++) {
            unsigned base = r == 4 ? 0xE0 : 0x20 + (unsigned)r * 0x20;

            t_checkl(shadow[b + base + m], rec[r * 4], "op1");
            t_checkl(shadow[b + base + m + 3], rec[r * 4 + 1], "op2");
            t_checkl(shadow[b + base + m + 8], rec[r * 4 + 2], "op3");
            t_checkl(shadow[b + base + m + 11], rec[r * 4 + 3], "op4");
        }
        t_checkl(shadow[b + 0xC0 + m], rec[20] | 0x30, "C0h first channel with its output bits");
        t_checkl(shadow[b + 0xC0 + m + 3], rec[21] | 0x30, "C0h second channel with its output bits");
    }

    t_case("a four-operator note keys the pair's first channel");
    t_checkl(opl_note_on(48), 0, "slot 0");
    t_check(shadow[0xB0] & 0x20, "channel 0 keyed");
    t_check(!(shadow[0xB3] & 0x20), "channel 3 not keyed");
    t_checkl(opl_note_on(50), 1, "slot 1");
    t_checkl(opl_note_on(52), 2, "slot 2");
    t_checkl(opl_note_on(53), 3, "slot 3 is the pair 9+12");
    t_check(shadow[0x1B0] & 0x20, "channel 9 keyed");
    opl_note_on(54);
    opl_note_on(55);
    t_checkl(opl_note_on(56), 0, "the seventh note takes the oldest pair");
    opl_shutdown();
    opl_sink = NULL;
}

static void test_opl2_four_op(void)
{
    Voice v = make_voice(0, 0);

    t_case("a four-operator voice writes nothing and plays nothing on an OPL2");
    fresh();
    opl_sink = sink;
    opl_init(2);
    t_check(max_reg < 0x100, "no bank 1 write at init");
    writes = 0;
    opl_set_voice(&v, 4, 4);
    t_checkl(writes, 0, "no writes");
    t_checkl(opl_note_on(60), -1, "no slot");
    t_checkl(writes, 0, "still no writes");
    opl_set_voice(&v, 2, 4);
    t_checkl(opl_note_on(60), 0, "a two-operator voice plays again");
    opl_shutdown();
    t_check(max_reg < 0x100, "no bank 1 write on an OPL2");
    opl_sink = NULL;
}

static void test_slots(void)
{
    Voice v = make_voice(0, 0);
    int i;

    t_case("held notes take separate slots and release");
    fresh();
    opl_sink = sink;
    opl_init(3);
    opl_set_voice(&v, 2, 4);
    t_checkl(opl_note_on(60), 0, "first");
    t_checkl(opl_note_on(64), 1, "second");
    t_checkl(opl_note_on(67), 2, "third");
    t_checkl(keyed_count(), 3, "three keyed");
    t_checkl(opl_note_on(60), 0, "a note already sounding keeps its slot");
    t_checkl(keyed_count(), 3, "still three");
    opl_note_off(64);
    t_checkl(keyed_count(), 2, "one released");
    opl_note_off(60);
    opl_note_off(67);
    t_checkl(keyed_count(), 0, "all released");
    t_checkl(opl_note_on(70), 0, "the lowest free slot is reused");
    opl_all_off();
    t_checkl(keyed_count(), 0, "all_off keys everything off");

    t_case("an OPL3 has 18 slots, an OPL2 nine; the oldest is stolen");
    for (i = 0; i < 18; i++) t_checkl(opl_note_on(i), i, "OPL3 slot");
    t_checkl(keyed_count(), 18, "all keyed");
    t_checkl(opl_note_on(40), 0, "the 19th takes the oldest");
    t_checkl(opl_note_on(41), 1, "then the next oldest");
    t_checkl(opl_note_on(96), -1, "out of range");
    opl_shutdown();
    opl_init(2);
    opl_set_voice(&v, 2, 4);
    for (i = 0; i < 9; i++) t_checkl(opl_note_on(i), i, "OPL2 slot");
    t_checkl(opl_note_on(40), 0, "the tenth takes the oldest");
    opl_shutdown();
    opl_sink = NULL;
}

static void test_pitch(void)
{
    Voice v = make_voice(0, 0);
    unsigned f0;
    unsigned f;

    t_case("pitch: block, F-number and the octave shift");
    fresh();
    opl_sink = sink;
    opl_init(3);
    opl_set_voice(&v, 2, 4);
    opl_note_on(57);
    f = fnum_of(0);
    t_checkl(block_of(0), 4, "A4 at block 4");
    t_check(f >= 579 && f <= 581, "A4 is about 440 Hz");
    opl_all_off();

    opl_note_on(0);
    f0 = fnum_of(0);
    t_checkl(block_of(0), 0, "C0 at block 0");
    opl_all_off();
    opl_set_voice(&v, 2, 3);
    opl_note_on(0);
    t_checkl(block_of(0), 0, "block stays 0 one octave down");
    t_checkl(fnum_of(0), f0 / 2, "the F-number is halved");
    opl_all_off();

    opl_set_voice(&v, 2, 5);
    opl_note_on(12);
    t_checkl(block_of(0), 2, "C1 one octave up is block 2");
    opl_all_off();
    opl_note_on(84);
    t_checkl(block_of(0), 7, "C7 one octave up stays at block 7");
    t_checkl(fnum_of(0), 690, "the F-number is doubled");
    opl_all_off();
    opl_set_voice(&v, 2, 7);
    opl_note_on(84);
    t_checkl(block_of(0), 7, "block clamped at 7");
    t_checkl(fnum_of(0), 1023, "the F-number doubled and held at its limit");
    opl_shutdown();
    opl_sink = NULL;
}

static void test_switch_and_shutdown(void)
{
    Voice v2 = make_voice(0, 0);
    Voice v4 = make_voice(1, 0);
    int i;

    t_case("switching two to four operators keys every channel off before 104h");
    fresh();
    opl_sink = sink;
    opl_init(3);
    opl_set_voice(&v2, 2, 4);
    for (i = 0; i < 3; i++) opl_note_on(60 + i);
    opl_set_voice(&v4, 4, 4);
    t_checkl(keyed_at_pairs, 0, "nothing keyed when the pairing changed");
    t_checkl(shadow[0x104], 0x3F, "pairs on");
    opl_set_voice(&v2, 2, 4);
    t_checkl(shadow[0x104], 0, "pairs off again");
    t_checkl(keyed_at_pairs, 0, "nothing keyed then either");

    t_case("shutdown leaves the chip quiet and out of OPL3 mode");
    opl_set_voice(&v4, 4, 4);
    opl_note_on(60);
    opl_shutdown();
    t_checkl(shadow[0x104], 0, "104h");
    t_checkl(shadow[0x105], 0, "105h");
    t_checkl(keyed_count(), 0, "nothing keyed");
    for (i = 0; i < 9; i++) {
        unsigned reg = 0x43 + (unsigned)(i % 3) + (unsigned)(i / 3) * 8;

        t_checkl(shadow[reg] & 0x3F, 63, "carrier TL 63, bank 0");
        t_checkl(shadow[0x100 + reg] & 0x3F, 63, "carrier TL 63, bank 1");
    }
    t_checkl(opl_chip(), 0, "the driver has let go");
    t_checkl(opl_note_on(60), -1, "no notes after shutdown");
    opl_sink = NULL;
}

static void test_trace(void)
{
    static char text[3000];
    Voice v = make_voice(0, 0);
    FILE *f;
    unsigned n = 0;
    int keys = 0;
    const char *at;

    t_case("register writes are traced only under /TRACE");
    fresh();
    opl_sink = sink;
    remove("TRACE.LOG");
    t_checkl(log_open("TRACE.LOG"), 0, "log opens");
    opl_init(2);
    log_set_trace(1);
    opl_set_voice(&v, 2, 4);
    opl_note_on(60);
    log_set_trace(0);
    opl_note_off(60);
    log_close();
    f = fopen("TRACE.LOG", "rb");
    if (f != NULL) {
        n = (unsigned)fread(text, 1, sizeof text - 1, f);
        fclose(f);
    }
    text[n] = '\0';
    t_check(strstr(text, "OPL 0A0=59") != NULL, "the F-number write is traced");
    t_check(strstr(text, "OPL 001=") == NULL, "writes from before tracing was on are not traced");
    for (at = text; (at = strstr(at, "OPL 0B0=")) != NULL; at++) keys++;
    t_checkl(keys, 1, "the key-on is traced and the untraced key-off is not");
    opl_shutdown();
    opl_sink = NULL;
    remove("TRACE.LOG");
}

static void test_jingle(void)
{
    t_case("the jingle plays on the chip and stops at once");
    fresh();
    opl_sink = sink;
    jingle_start();
    t_checkl(writes, 0, "with no chip it does nothing");
    opl_init(3);
    jingle_start();
    t_checkl(keyed_count(), 1, "the first note sounds");
    t_checkl(shadow[0x20], 0x23, "on the bell voice");
    jingle_stop();
    t_checkl(keyed_count(), 0, "keyed off at once");
    jingle_poll();
    t_checkl(keyed_count(), 0, "polling after a stop does nothing");
    opl_shutdown();
    opl_sink = NULL;
}

static void test_card(void)
{
    char buf[40];

    t_case("the card name from BLASTER");
    putenv("BLASTER=A220 I5 D1 H5 T6");
    opl_card(buf, sizeof buf);
    t_check(strcmp(buf, "Sound Blaster 16 at 220h") == 0, "SB16 at 220h");
    putenv("BLASTER=a240 i7 d1 t3");
    opl_card(buf, sizeof buf);
    t_check(strcmp(buf, "Sound Blaster 2.0 at 240h") == 0, "lower case, SB 2.0");
    opl_card(buf, 8);
    t_checkl((long)strlen(buf), 7, "cut to the buffer");
    putenv("BLASTER=");
    opl_card(buf, sizeof buf);
    t_checkl(buf[0], 0, "empty when BLASTER is empty");
}

int main(int argc, char **argv)
{
    int want = argc > 1 && stricmp(argv[1], "/OPL2") == 0 ? 2 : 3;

    t_case("detection finds the emulated chip");
    t_checkl(opl_detect(), want, "chip kind");

    test_factory();
    test_mapping();
    test_four_op();
    test_opl2_four_op();
    test_slots();
    test_pitch();
    test_switch_and_shutdown();
    test_trace();
    test_jingle();
    test_card();
    return t_done();
}
