"""Regenerate the guard mutations in mutation_sweep.py from the contract.

The guard half of the sweep is DERIVED, not hand-listed: every unique
single-line `if` that immediately protects a `raise gl.vm.UserError` becomes a
mutant that disables it. Anchors are then exact by construction -- one cannot
drift from the contract, because it was read out of it -- and a guard added
later is swept as soon as this is re-run.

Verda's sweep was hand-listed, which is why it silently rotted the moment it
was copied into this repo: every anchor still named the other contract's
source and nothing matched.

This does NOT touch the hand-written arithmetic mutants at the end of the list
(the majority test, the contradicting count, the bond floor, the payout, the
premium), or EQUIVALENT_NOT_RUN. Those are judgements, not derivations.

    python tests/generate_mutations.py            # report drift only
    python tests/generate_mutations.py --write    # rewrite the guard block
"""

import collections
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONTRACT = ROOT / "contracts" / "triggera.py"
SWEEP = ROOT / "tests" / "mutation_sweep.py"

BEGIN = "    # -- guards, derived from the source: each disables one refusal --------"
END = "    # -- the arithmetic that decides outcomes and money -------------------"


def guards():
    """Every unique single-line `if` that immediately protects a refusal."""
    src = CONTRACT.read_text(encoding="utf-8").split("\n")
    seen = collections.Counter(src)

    def owner(n):
        for j in range(n, -1, -1):
            m = re.match(r"\s*def (\w+)", src[j])
            if m:
                return m.group(1)
        return "?"

    out = []
    for i, line in enumerate(src):
        s = line.strip()
        if not (s.startswith("if ") and s.endswith(":")):
            continue
        if "raise gl.vm.UserError" not in "\n".join(src[i + 1:i + 3]):
            continue
        # A repeated line is not a usable anchor: a literal replace would hit
        # the wrong site, and the sweep would test something it did not name.
        if seen[line] != 1:
            continue
        indent = line[:len(line) - len(line.lstrip())]
        out.append((f"{owner(i)}: {s[3:-1][:66]}", line, indent + "if False:"))
    return out


def equivalent_names(text):
    """Names listed in EQUIVALENT_NOT_RUN are deliberately not swept, and the
    sweep records why. Re-deriving must not quietly put them back."""
    m = re.search(r"EQUIVALENT_NOT_RUN = \[(.*?)\]", text, re.S)
    return set(re.findall(r'"([^"]+)"', m.group(1))) if m else set()


def main() -> int:
    text = SWEEP.read_text(encoding="utf-8")
    skip = equivalent_names(text)
    found = [g for g in guards() if g[0] not in skip]
    if skip:
        print(f"excluded {len(skip)} listed in EQUIVALENT_NOT_RUN: "
              + ", ".join(sorted(skip)))
    if BEGIN not in text or END not in text:
        print("cannot find the guard block markers in mutation_sweep.py")
        return 2

    block = "\n".join(
        "    (%r,\n     %r,\n     %r),\n" % m for m in found)
    head, rest = text.split(BEGIN, 1)
    _, tail = rest.split(END, 1)
    rebuilt = head + BEGIN + "\n" + block + "\n" + END + tail

    contract = CONTRACT.read_text(encoding="utf-8")
    bad = [n for n, old, _ in found if contract.count(old) != 1]
    print(f"{len(found)} guard mutations derived; anchors resolving once: "
          f"{len(found) - len(bad)}/{len(found)}")
    for n in bad:
        print("  ANCHOR NOT UNIQUE:", n)

    if "--write" in sys.argv:
        SWEEP.write_text(rebuilt, encoding="utf-8", newline="\n")
        print("rewrote the guard block in tests/mutation_sweep.py")
    elif rebuilt != text:
        print("DRIFT: the guard block is out of date. Re-run with --write.")
        return 1
    else:
        print("the guard block matches the contract.")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
