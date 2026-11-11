import sys, os, glob
src, dst, cut = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(dst, exist_ok=True)
for f in glob.glob(os.path.join(src, "*.csv")):
    lines = open(f).read().splitlines()
    keep = [lines[0]] + [l for l in lines[1:] if l[:10] <= cut]
    if len(keep) > 1: open(os.path.join(dst, os.path.basename(f)), "w").write("\n".join(keep) + "\n")
