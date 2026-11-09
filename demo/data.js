/* Master/reference data. Grades & packaging mirror the PUBLIC catalogue at bismicashewcompany.com.
   Factories, suppliers, customers and every transaction are FICTIONAL demo records. */
const MASTER = {
  org: 'Demo Cashew Operations',
  today: '2026-11-09',
  factories: Array.from({length:7},(_,i)=>({id:'F0'+(i+1),name:'Factory 0'+(i+1),location:'Demo Location '+'ABCDEFG'[i],status:i===6?'Maintenance':'Active',capacity:[8000,6000,6500,5000,7000,4500,3000][i]})),
  packingCentres:[{id:'PC01',name:'Packing Centre 01',location:'Demo Location P'},{id:'PC02',name:'Packing Centre 02',location:'Demo Location Q'}],
  warehouses:[{id:'WH-RAW-1',name:'Raw Store 1'},{id:'WH-RAW-2',name:'Raw Store 2'},{id:'WH-FG-1',name:'Finished Goods Store 1'},{id:'WH-FG-2',name:'Finished Goods Store 2'}],
  suppliers:[
    {id:'SUP-A',name:'Supplier A',country:'Ivory Coast'},
    {id:'SUP-B',name:'Supplier B',country:'Ghana'},
    {id:'SUP-C',name:'Supplier C',country:'Tanzania'},
    {id:'SUP-D',name:'Supplier D',country:'Benin'},
    {id:'SUP-E',name:'Supplier E',country:'Guinea-Bissau'},
    {id:'SUP-F',name:'Supplier F',country:'Indonesia'}],
  customers:[
    {id:'CUS-01',name:'ABC Foods',country:'United Kingdom',currency:'GBP'},
    {id:'CUS-02',name:'Northwind Snacks',country:'United States',currency:'USD'},
    {id:'CUS-03',name:'Rhein Nuss Handel',country:'Germany',currency:'EUR'},
    {id:'CUS-04',name:'Gulf Pantry Trading',country:'United Arab Emirates',currency:'USD'},
    {id:'CUS-05',name:'Sakura Nuts Co.',country:'Japan',currency:'USD'}],
  categories:{WW:'White Wholes',SW:'Scorched Wholes',DW:'Dessert Wholes',WP:'White Pieces',SP:'Scorched Pieces',DP:'Dessert Pieces'},
  grades:[
    {id:'W-180',name:'White Wholes 180',cat:'WW',form:'Whole',colour:'White / pale ivory / light ash',count:'170–180',moist:5,broken:5,nlg:'5 (NLSG & SW)',v:'ok',note:'"King of Cashew" — largest whole'},
    {id:'W-210',name:'White Wholes – 210',cat:'WW',form:'Whole',colour:'White / pale ivory / light ash',count:'200–210',moist:5,broken:5,nlg:'5 (NLSG & SW)',v:'ok'},
    {id:'W-240',name:'White Wholes – 240',cat:'WW',form:'Whole',colour:'White / pale ivory / light ash',count:'220–240',moist:5,broken:5,nlg:'5 (NLSG & SW)',v:'ok'},
    {id:'W-320',name:'White Wholes – 320',cat:'WW',form:'Whole',colour:'White / pale ivory / light ash',count:'300–320',moist:5,broken:5,nlg:'5 (NLSG & SW)',v:'ok',note:'Most popular & widely available grade'},
    {id:'W-450',name:'White Wholes – 450',cat:'WW',form:'Whole',colour:'White / pale ivory / light ash',count:'400–450',moist:5,broken:5,nlg:'5 (NLSG & SW)',v:'ok'},
    {id:'SW-210',name:'Scorched Wholes – 210',cat:'SW',form:'Whole',colour:'Slightly darkened (drier/borma)',count:'200–210',moist:5,broken:5,nlg:'7.5 (NLSG & SSW)',v:'ok'},
    {id:'SW-240',name:'Scorched Wholes – 240',cat:'SW',form:'Whole',colour:'Slightly darkened (drier/borma)',count:'220–240',moist:5,broken:5,nlg:'7.5 (NLSG & SSW)',v:'ok'},
    {id:'SW-320',name:'Scorched Wholes – 320',cat:'SW',form:'Whole',colour:'Slightly darkened (drier/borma)',count:'300–320',moist:5,broken:5,nlg:'7.5 (NLSG & SSW)',v:'ok'},
    {id:'SW-450',name:'Scorched Wholes – 450',cat:'SW',form:'Whole',colour:'Slightly darkened (drier/borma)',count:'400–450',moist:5,broken:5,nlg:'7.5 (NLSG & SSW)',v:'ok',note:'Website title has no code; code confirmed in spec PDF'},
    {id:'S',name:'Splits – S',cat:'WP',form:'Split lengthwise',colour:'White / pale ivory / light ash',count:'—',moist:5,broken:5,nlg:'5 (SS)',v:'ok'},
    {id:'BB',name:'Baby Bits – BB',cat:'WP',form:'Bits',colour:'White / pale ivory / light ash',count:'—',sieve:'≥ 1.70 mm (10 mesh 24 SWG)',moist:5,broken:null,nlg:'1 (cashew powder)',v:'ok'},
    {id:'SSP',name:'Scorched Small Pieces – SSP',cat:'SP',form:'Small piece',colour:'Slightly darkened',count:'—',sieve:'≥ 2.80 mm (6 mesh 20 SWG)',moist:5,broken:null,nlg:'5 (DSP)',v:'ok',note:'Distinct from SPS per spec PDF'},
    {id:'SSW',name:'Scorched Wholes Second',cat:'DW',form:'Whole',colour:'Over-scorched, shrivelled, speckled, light blue',count:'—',moist:5,broken:5,nlg:'7.5 (DW)',v:'ok',note:'Website title has no code; "SSW" confirmed in spec PDF'},
    {id:'SS',name:'Scorched Splits – SS',cat:'SP',form:'Split lengthwise',colour:'Slightly darkened',count:'—',moist:5,broken:5,nlg:'7.5 (DS)',v:'flag',note:'Website text calls it "SP", but spec PDF uses SP for Scorched Pieces — confirm',alias:'SP?'},
    {id:'B',name:'Butts – B',cat:'WP',form:'Butt (cross-wise)',colour:'White / pale ivory / light ash',count:'—',moist:5,broken:5,nlg:'5 (SB)',v:'ok'},
    {id:'LWP',name:'Large White Pieces – LWP',cat:'WP',form:'Large piece',colour:'White / pale ivory / light ash',count:'—',sieve:'≥ 4.75 mm (4 mesh 16 SWG)',moist:5,broken:null,nlg:'5 (SW & SP)',v:'ok'},
    {id:'SB',name:'Scorched Butts – SB',cat:'SP',form:'Butt (cross-wise)',colour:'Slightly darkened',count:'—',moist:5,broken:5,nlg:'7.5 (DB)',v:'ok'},
    {id:'SPS',name:'Scorched Pieces Seconds – SPS',cat:'DP',form:'Piece',colour:'Over-scorched, shrivelled, speckled',count:'—',sieve:'≥ 4.75 mm (4 mesh 16 SWG)',moist:5,broken:null,nlg:'7.5 (DP & DSP)',v:'ok',note:'Distinct from SSP per spec PDF'},
    {id:'SWP',name:'Small White Pieces – SWP',cat:'WP',form:'Small piece',colour:'White / pale ivory / light ash',count:'—',sieve:'≥ 2.80 mm (6 mesh 20 SWG)',moist:5,broken:null,nlg:'5 (BB & SSP)',v:'ok'}],
  // grades present in the published kernel specification PDF but NOT in the 19-item web catalogue
  specOnlyGrades:[
    {id:'W-500',name:'White Wholes 500',count:'450–500'},{id:'SW',name:'Scorched Wholes (ungraded)',count:'N.A'},
    {id:'SW-180',name:'Scorched Wholes 180',count:'170–180'},{id:'SW-500',name:'Scorched Wholes 500',count:'450–500'},
    {id:'DW',name:'Dessert Wholes',count:'N.A'},{id:'SP',name:'Scorched Pieces',count:'N.A'},{id:'DP',name:'Dessert Pieces',count:'N.A'}],
  packaging:[
    {id:'PK-50F',name:'50 lb flexi-pouch',lb:50,method:'CO₂ + N₂, partial vacuum'},
    {id:'PK-25F',name:'25 lb flexi-pouch',lb:25,method:'CO₂ + N₂, partial vacuum'},
    {id:'PK-25T',name:'25 lb tin',lb:25,method:'Vacuumed, hermetically sealed'},
    {id:'PK-10T',name:'10 kg tin',kg:10,method:'Vacuumed, hermetically sealed'}],
  outputTypes:[
    {id:'SHELL',name:'Shell',required:true},{id:'TESTA',name:'Testa (husk)',required:true},
    {id:'REJ',name:'Rejects / unpeeled',required:false},{id:'OTH',name:'Other recorded',required:false}],
  qualityTests:[
    {id:'moist',name:'Moisture',unit:'%'},{id:'broken',name:'Broken kernels',unit:'%'},{id:'nlg',name:'NLSG / NLG',unit:'%'},
    {id:'count',name:'Count per 454 g',unit:'#'},{id:'colour',name:'Colour / characteristics',unit:'visual'},
    {id:'infest',name:'Infestation, mould, rancidity, adhering testa',unit:'visual'}],
  roles:['Managing Director','Factory Manager','Production Supervisor','Quality Inspector','Inventory Manager','Sales / Export Manager','Auditor'],
  people:{'Managing Director':'A. Rahman','Factory Manager':'K. Nair','Production Supervisor':'S. Pillai','Quality Inspector':'M. Thomas','Inventory Manager':'R. Menon','Sales / Export Manager':'J. Varghese','Auditor':'L. George'}
};
// canonical sample output from the workbook (sums to 1,330 kg)
MASTER.sampleOutput = {'W-180':80,'W-210':120,'W-240':250,'W-320':450,'W-450':150,'SW-320':80,'S':70,'B':40,'LWP':50,'SWP':30,'BB':10};

// Public company facts (source: public website pages, read 9 Nov 2026) — to be validated in discovery
MASTER.profile = {
  established:'2006 (proprietary concern, later partnership)', hq:'Kollam, Kerala, India',
  operations:'7 factories · 2 packing centres', moq:15000,
  certifications:['BRCGS Food Safety — Grade AA','FSSC 22000','HACCP','ISO 9001 (QMS)','ISO 22000 (FSMS)','FSSAI','India Organic','Star Export House (Govt. of India)'],
  markets:['United States','United Kingdom','European countries','Middle East','Other Asian countries'],
  origins:['Ivory Coast','Benin','Tanzania','Guinea-Bissau','Indonesia','Ghana'],
  related:[['Trading entity','Dubai, UAE'],['Trading entity','Abidjan, Ivory Coast'],['Processing / export entity','Kollam, India'],['Trading entity','Norwich, United Kingdom'],['Export entity','Kollam, India']],
  capabilities:['Own processing','In-house quality analysis','Pre-shipment quality inspection','Process & procedure optimisation','After-sales support'],
  specSource:'Published "Cashew Kernels Specification" PDF (2014)'
};
