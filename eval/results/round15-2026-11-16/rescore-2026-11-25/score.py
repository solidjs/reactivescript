import re,glob,os,sys,collections
H=os.path.dirname(os.path.abspath(__file__)); G=os.path.join(H, "../grades")
LEFT=re.compile(r"after (the|its)? ?(board|archive|issues page|page) was left|answers after the page was left")
ARMS=["rx","react","contract","xstate","foldkit","vanilla"]
rows={}; valid=collections.Counter()
for p in sorted(glob.glob(G+"/*.txt")):
    d=os.path.basename(p)[:-4]; t=open(p).read()
    fails=[f.strip() for f in re.findall(r"^✗ (.*?)\s*$",t,re.M)]
    fz=re.search(r"(\d+)/20 seeds found a hole",t); seeds0=int(fz.group(1)) if fz else 20
    nf=H+f"/fuzz/{d}.txt"; seeds=seeds0
    if os.path.exists(nf):
        m=re.search(r"(\d+)/20 seeds found a hole",open(nf).read()); seeds=int(m.group(1)) if m else 20
    ok=set()
    for h in glob.glob(H+f"/holds/{d}.*.txt"):
        ok|={m.group(1) for m in re.finditer(r"^✓ HOLD (.*?)\s*$",open(h).read(),re.M)}
    left=[f for f in fails if LEFT.search(f)]
    held=[f for f in fails if f in ok and not LEFT.search(f)]
    for f in held: valid[(d.split('-')[1],f)]+=1
    kept=len(fails)-len(left)-len(held)
    task,arm,tier,_=d.split("-")
    rows[d]=(task,arm,tier,kept+seeds,len(fails)-len(left)+seeds0,len(held),seeds0,seeds)
mean=lambda x:sum(x)/len(x)
print("tier task | arm: new (old with after-left out, no holds) [valid holds, fuzz old->new]")
for tier in ("opus","haiku"):
  for task in ("desk9","board"):
    out=[]
    for a in ARMS:
      v=[r for r in rows.values() if r[0]==task and r[1]==a and r[2]==tier]
      if v: out.append(f"{a} {mean([r[3] for r in v]):.2f} ({mean([r[4] for r in v]):.2f}) [{sum(r[5] for r in v)}, {sum(r[6] for r in v)}->{sum(r[7] for r in v)}]")
    print(tier,task," | ".join(out))
if "-v" in sys.argv:
  for d,r in rows.items(): print(d,r)
  for (a,f),n in valid.most_common(): print(n,a,f)
