import importlib.util
import pathlib
import unittest
spec = importlib.util.spec_from_file_location('motion', pathlib.Path(__file__).parents[1]/'blender/motion.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def sample():
    return {'version':1,'units':{'angle':'deg','length':'mm'},'joints':[
        {'name':'turn','parent':'base','child':'wheel','type':'revolute','value':10,'axis':[0,0,1],'origin':[0,0,0]},
        {'name':'slide','parent':'base','child':'jaw','type':'slider','value':0,'axis':[1,0,0],'origin':[0,0,0]}],
        'couplings':[{'name':'drive','value':0,'gears':{'turn':1,'slide':-.1}}],
        'animations':[{'name':'open','easing':'linear','keys':[{'time':0,'values':{'drive':0}}, {'time':4,'values':{'drive':-360}}, {'time':5,'values':{}}, {'time':9,'values':{'drive':0}}]}]}

class MotionTests(unittest.TestCase):
    def test_couplings_hold_and_base_offset(self):
        p=m.prepare(sample(),'open')
        self.assertAlmostEqual(m.values_at(p,2)['turn'],-170)
        self.assertAlmostEqual(m.values_at(p,4.5)['slide'],36)
        self.assertAlmostEqual(m.values_at(p,9)['turn'],10)
    def test_ease(self):
        k=sample(); k['animations'][0]['easing']='ease'
        self.assertAlmostEqual(m.values_at(m.prepare(k,'open'),1)['slide'],5.625)
    def test_cycles_and_nonfinite_refused(self):
        k=sample(); k['joints'][0]['parent']='wheel'
        with self.assertRaisesRegex(ValueError,'Cyclic'):m.prepare(k,'open')
        k=sample(); k['joints'][0]['axis'][0]=float('inf')
        with self.assertRaisesRegex(ValueError,'finite'):m.prepare(k,'open')
    def test_unsupported_not_silently_ignored(self):
        k=sample(); k['joints'][0]['type']='cylindrical'
        with self.assertRaisesRegex(ValueError,'GLB'):m.prepare(k,'open')
        with self.assertRaisesRegex(ValueError,'Choose'):m.prepare(sample(),'missing')

if __name__=='__main__':unittest.main()
