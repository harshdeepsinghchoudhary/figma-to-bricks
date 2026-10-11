import json,sys
f=sys.argv[1]; lim=int(sys.argv[2]) if len(sys.argv)>2 else 200
d=json.load(open(f)); n=[0]
def rec(e,dep):
    if n[0]>lim: return
    n[0]+=1
    lay=e.get('layout',{}); sz=e.get('size',{}); ty=e.get('typography',{})
    keys=('direction','gap','align','justify','padding','margin','display','gridColumns')
    s=' '.join(f"{k}={v}" for k,v in {**{k:lay[k] for k in lay if k in keys}, **{('w' if k=='width' else 'mw' if k=='maxWidth' else k):v for k,v in sz.items()}}.items())
    extra=''
    if e.get('background'): extra+=' bg='+json.dumps(e['background'])[:40]
    if e.get('border'): extra+=' bd='+json.dumps(e['border'])
    t=e.get('text','')
    print('  '*dep+f"{e['type']}[{e.get('id')}|{e.get('figmaNodeId','')}] {s}{extra} {('«'+t[:26]+'» '+str(ty.get('fontSize'))+'/'+str(ty.get('fontWeight'))) if t else ''}")
    for c in e.get('children',[]): rec(c,dep+1)
rec(d['children'][0] if d.get('type')=='page' else d,0)
