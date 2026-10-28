function Catalog({go}){
  const {Breadcrumbs,Select,RangeSlider,Checkbox,Button,ProjectCard,Radio}=NSX;const D=window.LD_DATA;
  const [price,setPrice]=React.useState([2000000,10000000]);const [type,setType]=React.useState('Все');
  const list=D.projects.filter(p=>p.price>=price[0]&&p.price<=price[1]&&(type==='Все'||p.type===type));
  return <Container style={{padding:'24px 32px 0'}}>
    <Breadcrumbs items={['Главная','Проекты']} onNavigate={()=>go('home')}/>
    <h1 style={{font:'var(--text-h1)',color:'var(--text-heading)',margin:'16px 0 28px'}}>Проекты домов</h1>
    <div style={{display:'grid',gridTemplateColumns:'280px minmax(0,1fr)',gap:28,alignItems:'start'}}>
      <aside style={{background:'#fff',border:'1px solid var(--border-default)',borderRadius:'var(--radius-lg)',padding:20,display:'flex',flexDirection:'column',gap:20,position:'sticky',top:88}}>
        <Select label="Тип дома" options={['Все','Коттедж','Дуплекс','Баня']} value={type} onChange={e=>setType(e.target.value)}/>
        <RangeSlider label="Площадь, м²" min={40} max={300} defaultValue={[80,200]}/>
        <RangeSlider label="Стоимость, ₽" min={2000000} max={10000000} step={50000} value={price} onChange={setPrice}/>
        <div style={{display:'flex',flexDirection:'column',gap:10}}><span style={{font:'500 13px var(--font-body)',color:'var(--text-secondary)'}}>Этажность</span><Radio direction="row" options={['1','2','Любая']} defaultValue="Любая"/></div>
        <div style={{display:'flex',flexDirection:'column',gap:10}}><span style={{font:'500 13px var(--font-body)',color:'var(--text-secondary)'}}>Дополнительно</span><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}><Checkbox label="Гараж"/><Checkbox label="Терраса"/><Checkbox label="Камин"/><Checkbox label="Баня"/></div></div>
        <Button fullWidth>Показать {list.length} проектов</Button>
      </aside>
      <div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}><span style={{font:'var(--text-secondary-font)',color:'var(--text-secondary)'}}>Найдено {list.length} проектов</span><Select options={['Сначала популярные','Сначала дешевле','Сначала дороже']} style={{width:220}}/></div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:20}}>{list.map(p=><ProjectCard key={p.id} {...p} onOpen={()=>go('project',p.id)}/>)}</div>
        {list.length===0&&<div style={{padding:48,textAlign:'center',color:'var(--text-muted)'}}>Нет проектов под эти фильтры</div>}
      </div>
    </div>
  </Container>;
}
window.Catalog=Catalog;