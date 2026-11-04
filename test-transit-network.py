"""Geometry and source-regression checks. Run: python3 test-transit-network.py"""
import importlib.util,io,zipfile,unittest,json,tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('network',Path(__file__).with_name('gen-transit-network.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def feed(files):
    b=io.BytesIO()
    with zipfile.ZipFile(b,'w') as z:
        for name,text in files.items():z.writestr(name,text)
    b.seek(0);return zipfile.ZipFile(b)
class NetworkTests(unittest.TestCase):
    def test_disjoint_region_spans_are_not_connected(self):
        points=[[0,0],[.5,.5],[2,2],[3,3],[4,4],[2,0],[.5,0],[0,0]]
        chunks=m.clip(points,[-1,-1,1,1]);self.assertEqual(len(chunks),2);self.assertNotIn([3,3],sum(chunks,[]))
    def test_bends_survive_simplification(self):
        self.assertEqual(m.simplify([[0,0],[1,1],[2,0]]),[[0,0],[1,1],[2,0]])
    def test_expired_calendar_finds_real_service_day(self):
        z=feed({'calendar.txt':'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\na,1,1,1,1,1,0,0,20240101,20240131\n'})
        day,active=m.service_day(z);self.assertEqual(active,{'a'});self.assertTrue(day.startswith('2024-01-'))
    def test_missing_shapes_are_reported_not_invented(self):
        z=feed({'routes.txt':'route_id,route_type,route_short_name\nr,2,R\nb,3,B\n','stops.txt':'stop_id,stop_name,stop_lat,stop_lon\ns,Station,0,0\n','trips.txt':'route_id,trip_id,service_id,shape_id\nr,t,a,\nb,u,a,\n','stop_times.txt':'trip_id,stop_id\nt,s\nu,s\n'})
        f,s,meta=m.build_feed('test',{'name':'Test','url':'https://example.org','busLimit':20},z,[-1,-1,1,1]);self.assertEqual(f,[]);self.assertEqual(meta['missingGeometry'],['R'])
    def test_all_bundled_networks_have_valid_coordinates_and_complete_sources(self):
        for city in m.CFG['cities']:
            data=json.loads((m.HERE/'map-data'/('network-'+city+'.json')).read_text());self.assertFalse(data['metadata']['unavailable'])
            for source in data['metadata']['sources']:self.assertFalse(source['missingGeometry'],(city,source['name']))
            for f in data['features']:
                g=f['geometry'];points=[g['coordinates']] if g['type']=='Point' else [p for line in g['coordinates'] for p in line]
                self.assertTrue(points)
                for x,y in points:self.assertTrue(-180<=x<=180 and -90<=y<=90)
            refs={f['properties'].get('ref'):f['properties']['mode'] for f in data['features']}
            if city=='losangeles':self.assertEqual(refs['G'],'brt');self.assertEqual(refs['J'],'brt')
            if city=='dc':self.assertTrue({'red','orange','blue','green','yellow','silver'}.issubset(refs))
            if city=='zurich':self.assertIn('S2',refs)
if __name__=='__main__':unittest.main()
