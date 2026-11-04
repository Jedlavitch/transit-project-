#!/usr/bin/env python3
"""Build independent passenger networks from published GTFS shapes.

Never modifies the existing timetable bundles. Rail keeps every distinct shape;
major buses are ranked by scheduled trips on a representative weekday (not
ridership), with the principal shape in each direction. No straight stop-to-stop
geometry is substituted for a missing shape. Source coverage is recorded.
"""
import argparse, collections, csv, datetime as dt, hashlib, io, json, math
import subprocess, zipfile, sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
CFG=json.loads((HERE/'map-data/feeds.json').read_text())
COLORS={'rail':'#8562bd','metro':'#147bc1','tram':'#169879','bus':'#d59028','brt':'#c55225','ferry':'#408fa7'}

def rows(z,name):
    path=next((n for n in z.namelist() if n.rsplit('/',1)[-1]==name),None)
    if path is None:return iter(())
    return csv.DictReader(io.TextIOWrapper(z.open(path),encoding='utf-8-sig'))

def mode(r):
    n=int(r.get('route_type') or 3)
    if n in (0,5,7) or 900<=n<1000:return 'tram'
    if n==1 or 400<=n<500:return 'metro'
    if n==2 or 100<=n<200:return 'rail'
    if n==4 or 1000<=n<1100:return 'ferry'
    if n in (3,11) or 700<=n<900:return 'bus'
    return None

def inside(p,b):return b[1]<=p[0]<=b[3] and b[0]<=p[1]<=b[2]

def simplify(points,tolerance=0.00007):
    if len(points)<3:return points
    keep={0,len(points)-1}; todo=[(0,len(points)-1)]
    while todo:
        a,b=todo.pop();x,y=points[a];dx=points[b][0]-x;dy=points[b][1]-y;den=dx*dx+dy*dy;far=tolerance*tolerance;idx=None
        for i in range(a+1,b):
            t=max(0,min(1,((points[i][0]-x)*dx+(points[i][1]-y)*dy)/den)) if den else 0
            dist=(points[i][0]-x-t*dx)**2+(points[i][1]-y-t*dy)**2
            if dist>far:far=dist;idx=i
        if idx is not None:keep.add(idx);todo.extend([(a,idx),(idx,b)])
    return [points[i] for i in sorted(keep)]

def clip(points,b):
    """Retain in-region spans and their adjacent points; never join disjoint spans."""
    chunks=[]; chunk=[]
    for i,p in enumerate(points):
        include=inside(p,b) or i>0 and inside(points[i-1],b) or i+1<len(points) and inside(points[i+1],b)
        if include:chunk.append(p)
        elif chunk:
            if len(chunk)>1:chunks.append(simplify(chunk))
            chunk=[]
    if len(chunk)>1:chunks.append(simplify(chunk))
    return chunks

def service_day(z):
    today=dt.date.today();day=today+dt.timedelta(days=(1-today.weekday())%7)
    cal=list(rows(z,'calendar.txt'));exceptions=list(rows(z,'calendar_dates.txt'))
    # A current weekday within the feed horizon; if the feed is expired, keep
    # geometry but make that date visible in the source metadata.
    dates=sorted({r['date'] for r in exceptions if r.get('exception_type')=='1'})
    if dates and not (dates[0]<=day.strftime('%Y%m%d')<=dates[-1]):
        candidates=[d for d in dates if dt.datetime.strptime(d,'%Y%m%d').weekday()<5]
        if candidates:day=dt.datetime.strptime(min(candidates,key=lambda x:abs((dt.datetime.strptime(x,'%Y%m%d').date()-today).days)),'%Y%m%d').date()
    if cal and not any(r['start_date']<=day.strftime('%Y%m%d')<=r['end_date'] for r in cal):
        edges=[dt.datetime.strptime(r[k],'%Y%m%d').date() for r in cal for k in ('start_date','end_date')]
        candidates=[d+dt.timedelta(days=n) for d in edges for n in range(-6,7) if (d+dt.timedelta(days=n)).weekday()<5]
        candidates=[d for d in candidates if any(r['start_date']<=d.strftime('%Y%m%d')<=r['end_date'] and r.get(d.strftime('%A').lower())=='1' for r in cal)]
        if candidates:day=min(candidates,key=lambda d:abs((d-today).days))
    key=day.strftime('%Y%m%d');active={r['service_id'] for r in cal if r['start_date']<=key<=r['end_date'] and r.get(day.strftime('%A').lower())=='1'}
    for r in exceptions:
        if r['date']==key:
            if r['exception_type']=='1':active.add(r['service_id'])
            else:active.discard(r['service_id'])
    return day.isoformat(),active

def build_feed(fid,config,z,bounds):
    route={r['route_id']:r for r in rows(z,'routes.txt') if mode(r) and r.get('route_long_name') not in config.get('excludeNames',[])}
    stops={s['stop_id']:s for s in rows(z,'stops.txt')}
    date,active=service_day(z);counts=collections.Counter();patterns=collections.defaultdict(collections.Counter)
    trips={};shape_routes=collections.defaultdict(set)
    for t in rows(z,'trips.txt'):
        rid=t['route_id']
        if rid not in route:continue
        trips[t['trip_id']]=(rid,t.get('shape_id',''),t.get('direction_id','0'))
        if t['service_id'] in active:counts[rid]+=1;patterns[rid][(t.get('direction_id','0'),t.get('shape_id',''))]+=1
        if t.get('shape_id'):shape_routes[t['shape_id']].add(rid)
    # Limit the candidates to services that actually call within the city.
    local_routes=set();rail_stops=collections.defaultdict(set)
    for st in rows(z,'stop_times.txt'):
        trip=trips.get(st['trip_id']);s=stops.get(st['stop_id'])
        if not trip or not s:continue
        try:p=[float(s['stop_lon']),float(s['stop_lat'])]
        except (ValueError,KeyError):continue
        if inside(p,bounds):
            local_routes.add(trip[0])
            if mode(route[trip[0]]) not in ('bus','ferry'):rail_stops[st['stop_id']].add(trip[0])
    major=sorted((r for r in local_routes if mode(route[r])=='bus' and counts[r]>0),key=lambda r:(-counts[r],r))[:config.get('busLimit',0)]
    rapid=set(config.get('rapidRefs',[]));selected={r for r in local_routes if mode(route[r])!='bus' or r in major or (route[r].get('route_short_name') or route[r].get('route_long_name')) in rapid}
    if config.get('excludeBus'):selected={r for r in selected if mode(route[r])!='bus'}
    selected_shapes=collections.defaultdict(set)
    for sid,rids in shape_routes.items():
        for rid in rids&selected:
            if mode(route[rid])!='bus':selected_shapes[sid].add(rid)
    for rid in selected:
        if mode(route[rid])=='bus':
            used=set()
            for (direction,sid),count in patterns[rid].most_common():
                if sid and direction not in used:selected_shapes[sid].add(rid);used.add(direction)
    coords=collections.defaultdict(list)
    for s in rows(z,'shapes.txt'):
        if s['shape_id'] in selected_shapes:
            try:coords[s['shape_id']].append((int(s['shape_pt_sequence']),round(float(s['shape_pt_lon']),6),round(float(s['shape_pt_lat']),6)))
            except (ValueError,KeyError):continue
    geometries=collections.defaultdict(list);seen=collections.defaultdict(set)
    for sid,points in coords.items():
        lines=clip([[x,y] for _,x,y in sorted(points)],bounds)
        for rid in selected_shapes[sid]:
            for line in lines:
                key=tuple(tuple(p) for p in line);reverse=tuple(reversed(key));k=min(key,reverse)
                if k not in seen[rid]:seen[rid].add(k);geometries[rid].append(line)
    features=[];missing=[]
    for rid in sorted(selected):
        r=route[rid];ref=r.get('route_short_name') or r.get('route_long_name') or rid;m=mode(r)
        if ref in rapid:m='brt'
        ref=config.get('displayRefs',{}).get(ref,ref)
        if not geometries[rid]:missing.append(ref);continue
        color=r.get('route_color','');color='#'+color if len(color)==6 and all(c in '0123456789abcdefABCDEF' for c in color) else COLORS[m]
        features.append({'type':'Feature','properties':{'id':fid+':'+rid,'feed':fid,'ref':ref,'name':r.get('route_long_name') or ref,'agency':config['name'],'mode':m,'color':color,'url':r.get('route_url') if r.get('route_url','').startswith('https://') else '', 'weekdayTrips':counts[rid]},'geometry':{'type':'MultiLineString','coordinates':geometries[rid]}})
    stations=[];station_seen=set()
    for sid,rids in rail_stops.items():
        s=stops[sid];s=stops.get(s.get('parent_station'),s);key=(s.get('stop_name'),round(float(s['stop_lat']),4),round(float(s['stop_lon']),4))
        if key in station_seen:continue
        station_seen.add(key);stations.append({'type':'Feature','properties':{'name':s['stop_name'],'agency':config['name'],'mode':'station','modes':sorted({mode(route[r]) for r in rids if r in selected})},'geometry':{'type':'Point','coordinates':[float(s['stop_lon']),float(s['stop_lat'])]}})
    return features,stations,{'feed':fid,'name':config['name'],'url':config['url'],'serviceDate':date,'routes':len(features),'missingGeometry':missing}

def download(fid,cache):
    out=cache/(fid+'.zip')
    if not out.exists():
        result=subprocess.run(['curl','-L','--fail','--max-time','300','-sS',CFG['feeds'][fid]['url'],'-o',str(out)])
        if result.returncode:
            out.unlink(missing_ok=True);raise RuntimeError('Download failed: '+fid)
    return out

def supplement(fid,cache,bounds):
    config=CFG['geoSources'][fid];path=cache/(fid+'.json')
    if not path.exists():
        result=subprocess.run(['curl','-L','--fail','--max-time','120','-sS',config['url'],'-o',str(path)])
        if result.returncode:
            path.unlink(missing_ok=True);raise RuntimeError('Download failed: '+fid)
    data=json.loads(path.read_text())
    if data.get('exceededTransferLimit') or data.get('numberMatched',len(data.get('features',[])))>len(data.get('features',[])):
        raise RuntimeError('Incomplete geometry response: '+fid)
    routes={};stations=[]
    for f in data['features']:
        p=f['properties'];g=f['geometry'];name=' – '.join(str(p.get(k) or '') for k in config['nameFields'])
        if g['type']=='Point':
            if inside(g['coordinates'],bounds):stations.append({'type':'Feature','properties':{'feed':fid,'name':name,'agency':config['name'],'mode':'station','modes':config['stationModes']},'geometry':g})
            continue
        ref=str(p[config['refField']])
        if config.get('selectRefs') and ref not in config['selectRefs']:continue
        color=config.get('colors',{}).get(ref,config.get('color',COLORS[config['mode']]))
        ref=config.get('refs',{}).get(ref,ref)
        if ref not in routes:routes[ref]={'type':'Feature','properties':{'id':fid+':'+ref,'feed':fid,'ref':ref,'name':name,'agency':config['name'],'mode':config['mode'],'color':color,'url':config.get('selectionUrl','')},'geometry':{'type':'MultiLineString','coordinates':[]}}
        for line in ([g['coordinates']] if g['type']=='LineString' else g['coordinates']):
            routes[ref]['geometry']['coordinates']+=clip([[round(c[0],6),round(c[1],6)] for c in line],bounds)
    features=[r for r in routes.values() if r['geometry']['coordinates']]
    if not features and not stations:raise RuntimeError('No geometry: '+fid)
    return features,stations,{'feed':fid,'name':config['name'],'url':config['url'],'serviceDate':config['serviceDate'],'routes':len(features),'missingGeometry':[]}

def add_supplements(city,features,stations,sources,cache):
    for fid in CFG['cities'][city].get('geoSources',[]):
        f,s,meta=supplement(fid,cache,CFG['cities'][city]['bounds'])
        features[:]=[r for r in features if not r['properties'].get('id','').startswith(fid+':')]
        stations[:]=[r for r in stations if r['properties'].get('feed')!=fid]
        sources[:]=[r for r in sources if r.get('feed')!=fid]
        replacement=CFG['geoSources'][fid].get('replacesMissingFeed')
        if replacement:
            refs={r['properties']['ref'] for r in f}
            for old in sources:
                if old.get('feed')==replacement or old['name']==CFG['feeds'][replacement]['name']:
                    old['missingGeometry']=[r for r in old['missingGeometry'] if r not in refs]
        features+=f;stations+=s;sources.append(meta)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('cities',nargs='*');ap.add_argument('--cache',type=Path,default=HERE.parent/'map-downloads');ap.add_argument('--supplements-only',action='store_true');args=ap.parse_args();args.cache.mkdir(exist_ok=True,parents=True)
    for city in args.cities or CFG['cities']:
        cfg=CFG['cities'][city];features=[];stations=[];sources=[];failures=[]
        if args.supplements_only:
            previous=json.loads((HERE/'map-data'/('network-'+city+'.json')).read_text())
            features=[f for f in previous['features'] if f['geometry']['type']=='MultiLineString']
            stations=[f for f in previous['features'] if f['geometry']['type']=='Point'];sources=previous['metadata']['sources']
            # Retire known non-passenger placeholders from Amtrak's shared feed.
            for s in sources:
                s['missingGeometry']=[r for r in s['missingGeometry'] if r not in CFG['feeds']['amtrak']['excludeNames'] or s['name']!='Amtrak']
        for fid in ([] if args.supplements_only else cfg['feeds']):
            try:
                path=download(fid,args.cache)
                with zipfile.ZipFile(path) as z:
                    nested=[n for n in z.namelist() if n.endswith('.zip')]
                    feeds=[zipfile.ZipFile(io.BytesIO(z.read(n))) for n in nested] if nested else [z]
                    for feed in feeds:
                        f,s,meta=build_feed(fid,CFG['feeds'][fid],feed,cfg['bounds']);features+=f;stations+=s;sources.append(meta)
                print(city,fid,'routes',len(features),'stations',len(stations),flush=True)
            except Exception as e:failures.append({'feed':fid,'error':str(e)});print('ERROR',city,fid,str(e),flush=True)
        if failures:raise RuntimeError('Source download failed; existing city bundle retained: '+city)
        add_supplements(city,features,stations,sources,args.cache)
        if not features:raise RuntimeError('No route geometry for '+city)
        missing=[s for s in sources if s['missingGeometry']]
        if missing:raise RuntimeError('Missing route geometry; existing city bundle retained: '+city+' '+str(missing))
        out={'type':'FeatureCollection','features':features+stations,'metadata':{'city':city,'generated':dt.date.today().isoformat(),'bounds':cfg['bounds'],'sources':sources,'unavailable':failures,'busSelection':'Highest scheduled weekday trip counts in the source feed; principal shape per direction. Not ridership or live frequency.'}}
        target=HERE/'map-data'/('network-'+city+'.json');temp=target.with_suffix('.tmp')
        temp.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')));temp.replace(target)
        print('WROTE',city,len(features),'routes',len(stations),'stations',len(failures),'unavailable feeds',flush=True)
if __name__=='__main__':main()
