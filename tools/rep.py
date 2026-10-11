import json,sys
m=json.load(open(sys.argv[1]))['1440']
names=json.load(open(sys.argv[2]))
fg=json.load(open(sys.argv[3]))
tops=sorted([c for c in fg['children'] if c.get('visible') is not False and c.get('absoluteBoundingBox')],key=lambda c:(c['absoluteBoundingBox']['y'],c['absoluteBoundingBox']['x']))
for k,v in sorted(m['per_section'].items(),key=lambda x:int(x[0])):
    t=tops[v['figma_top']]; 
    flag='  <<<' if v['bad']>2 else ''
    print(f"rsec {k:>2} {names.get(t['id'],t['id']):<11} n={v['n']:>2} bad={v['bad']:>2} dx={v['mean_dx']:>5.0f} dy={v['mean_dy']:>4.0f}{flag}")
print('missing:',m['missing'])
