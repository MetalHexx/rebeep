/* SUITE: OPL2 */
/* Proves the suite's OPL2 rerun reaches the emulator: the status port reads OPL3 on the default run and OPL2 on /OPL2. */
#include <conio.h>
#include <string.h>

#include "testlib.h"

#define OPL_INDEX 0x388
#define OPL_DATA 0x389
#define REG_TIMER1 0x02
#define REG_TIMCTL 0x04
#define OPL2_INDEX_READS 6
#define OPL2_DATA_READS 35

static void opl_write(unsigned char reg, unsigned char value)
{
    int i;

    outp(OPL_INDEX, reg);
    for (i = 0; i < OPL2_INDEX_READS; i++) inp(OPL_INDEX);
    outp(OPL_DATA, value);
    for (i = 0; i < OPL2_DATA_READS; i++) inp(OPL_INDEX);
}

static void reset_timers(void)
{
    opl_write(REG_TIMCTL, 0x60);
    opl_write(REG_TIMCTL, 0x80);
}

int main(int argc, char **argv)
{
    int want_opl2 = argc > 1 && stricmp(argv[1], "/OPL2") == 0;
    int i;
    int status;

    t_case("an OPL is present");
    reset_timers();
    opl_write(REG_TIMER1, 0xFF);
    opl_write(REG_TIMCTL, 0x21);
    for (i = 0; i < 200; i++) inp(OPL_INDEX);
    t_checkl(inp(OPL_INDEX) & 0xE0, 0xC0, "timer 1 overflow in the status port");
    reset_timers();

    t_case(want_opl2 ? "the /OPL2 run sees an OPL2" : "the default run sees an OPL3");
    status = inp(OPL_INDEX);
    t_checkl((status & 0x06) != 0, want_opl2, "status bits 1-2 are set only on an OPL2");

    return t_done();
}
