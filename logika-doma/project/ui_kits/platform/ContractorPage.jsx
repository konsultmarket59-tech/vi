function ContractorPage({go}){
  const {Breadcrumbs,Button,Rating,Icon,ProjectCard,Badge}=NSX;const D=window.LD_DATA;const c=D.contractors[0];
  const [tab,setTab]=React.useState('О компании');const tabs=['О компании','Проекты','Отзывы'];
  const stats=[['95','Построено домов'],['14 лет','На рынке'],['320+','Отзывов'],['4.9','Средний рейтинг']];
  return <Container style={{padding:'24px 32px 0'}}>
    <Breadcrumbs items={['Главная','Подрядчики',c.name]} onNavigate={()=>go('home')}/>
    <div style={{display:'flex',gap:24,alignItems:'center',margin:'20px 0 28px',background:'#fff',border:'1px solid var(--border-default)',borderRadius:'var(--radius-lg)',padding:28}}>
      <div style={{width:88,height:88,borderRadius:'50%',background:'var(--ld-navy-50)',display:'flex',alignItems:'center',justifyContent:'center',font:'700 30px var(--font-display)',color:'var(--ld-navy)'}}>СЛ</div>
      <div style={{flex:1,display:'flex',flexDirection:'column',gap:8}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}><h1 style={{font:'var(--text-h2)',color:'var(--text-heading)',margin:0}}>{c.name}</h1><span style={{display:'inline-flex',alignItems:'center',gap:4,font:'500 13px var(--font-body)',color:'var(--ld-cyan)'}}><Icon name="badge-check" size={16}/>Проверен</span></div>
        <span style={{color:'var(--text-secondary)'}}>{c.role}</span>
        <div style={{display:'flex',gap:20,alignItems:'center'}}><Rating value={c.rating} reviews={c.reviews}/><span style={{display:'inline-flex',gap:6,alignItems:'center',font:'400 13px var(--font-body)',color:'var(--text-secondary)'}}><Icon name="map-pin" size={14}/>{c.location}</span></div>
      </div>
      <div style={{display:'flex',gap:10}}><Button variant="secondary" icon="message-circle">Написать</Button><Button iconRight="arrow-right">Связаться</Button></div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16}}>{stats.map(([v,l])=><div key={l} style={{background:'#fff',border:'1px solid var(--border-default)',borderRadius:'var(--radius-md)',padding:20}}><div style={{font:'700 32px var(--font-display)',color:'var(--text-heading)'}}>{v}</div><div style={{font:'var(--text-secondary-font)',color:'var(--text-secondary)'}}>{l}</div></div>)}</div>
    <div style={{display:'flex',gap:28,borderBottom:'1px solid var(--border-default)',margin:'36px 0 24px'}}>{tabs.map(t=><a key={t} href="#" onClick={e=>{e.preventDefault();setTab(t)}} style={{padding:'12px 0',font:`${t===tab?600:500} 15px var(--font-body)`,color:t===tab?'var(--ld-navy)':'var(--text-secondary)',borderBottom:t===tab?'2px solid var(--ld-cyan)':'2px solid transparent',marginBottom:-1}}>{t}</a>)}</div>
    {tab==='О компании'&&<div style={{display:'grid',gridTemplateColumns:'minmax(0,1.4fr) minmax(0,1fr)',gap:28}}><p style={{font:'var(--text-body-lg, 400 18px/1.55 var(--font-body))',margin:0}}>Строим каркасные и газобетонные дома под ключ с 2012 года. Работаем по договору с фиксированной сметой, фотоотчётами каждого этапа и гарантией 5 лет.</p><div style={{display:'flex',gap:8,flexWrap:'wrap',alignContent:'flex-start'}}>{['Каркасные дома','Газобетон','Фундаменты','Инженерия','Отделка'].map(t=><Badge key={t} tone="soft">{t}</Badge>)}</div></div>}
    {tab==='Проекты'&&<div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:20}}>{D.projects.slice(0,3).map(p=><ProjectCard key={p.id} {...p} onOpen={()=>go('project',p.id)}/>)}</div>}
    {tab==='Отзывы'&&<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>{D.reviews.map(r=><div key={r.name} style={{background:'#fff',border:'1px solid var(--border-default)',borderRadius:'var(--radius-lg)',padding:20,display:'flex',flexDirection:'column',gap:10}}><div style={{display:'flex',justifyContent:'space-between'}}><b style={{font:'600 15px var(--font-display)'}}>{r.name}</b><Rating value={r.rating}/></div><p style={{margin:0,color:'var(--text-secondary)'}}>{r.text}</p></div>)}</div>}
  </Container>;
}
window.ContractorPage=ContractorPage;