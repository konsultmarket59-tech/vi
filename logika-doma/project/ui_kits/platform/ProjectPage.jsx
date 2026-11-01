function ProjectPage({go,id}){
  const {Breadcrumbs,Button,IconButton,Badge,Checkbox,StatusDot,ContractorCard,Icon,StepPath}=NSX;const D=window.LD_DATA;
  const p=D.projects.find(x=>x.id===id)||D.projects[0];
  const [img,setImg]=React.useState(0);const imgs=[p.image,'../../assets/images/plan-01.png','../../assets/images/plan-02.png'];
  const opts=[['Гараж на 1 авто',420000],['Терраса 24 м²',310000],['Камин',180000],['Тёплый пол',240000]];
  const [sel,setSel]=React.useState({});const total=p.price+opts.reduce((s,[n,v])=>s+(sel[n]?v:0),0);
  const spec=[['ruler','Площадь',p.area+' м²'],['bed-double','Комнаты',p.rooms],['bath','Санузлы',p.baths],['layers','Этажи',p.floors]];
  return <Container style={{padding:'24px 32px 0'}}>
    <Breadcrumbs items={['Главная','Проекты',p.title]} onNavigate={(it)=>go(it==='Главная'?'home':'catalog')}/>
    <div style={{display:'flex',alignItems:'center',gap:12,margin:'16px 0 24px'}}><h1 style={{font:'var(--text-h1)',color:'var(--text-heading)',margin:0}}>{p.title}</h1>{p.badge&&<Badge>{p.badge}</Badge>}<span style={{flex:1}}/><IconButton icon="heart" label="В избранное"/><IconButton icon="share-2" label="Поделиться"/><IconButton icon="download" label="Скачать PDF"/></div>
    <div style={{display:'grid',gridTemplateColumns:'minmax(0,1.6fr) minmax(0,1fr)',gap:28,alignItems:'start'}}>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <img src={imgs[img]} alt="" style={{width:'100%',aspectRatio:'16/10',objectFit:'cover',borderRadius:'var(--radius-lg)',border:'1px solid var(--border-default)',background:'#fff'}}/>
        <div style={{display:'flex',gap:12}}>{imgs.map((s,i)=><img key={i} src={s} onClick={()=>setImg(i)} style={{width:120,height:80,objectFit:'cover',borderRadius:'var(--radius-md)',cursor:'pointer',border:i===img?'2px solid var(--ld-cyan)':'1px solid var(--border-default)',boxSizing:'border-box'}}/>)}</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginTop:12}}>{spec.map(([ic,l,v])=><div key={l} style={{background:'#fff',border:'1px solid var(--border-default)',borderRadius:'var(--radius-md)',padding:16,display:'flex',flexDirection:'column',gap:6}}><Icon name={ic} color="var(--ld-cyan)"/><span style={{font:'var(--text-caption)',color:'var(--text-muted)'}}>{l}</span><span style={{font:'700 20px var(--font-display)',color:'var(--text-heading)'}}>{v}</span></div>)}</div>
        <h2 style={{font:'var(--text-h3)',color:'var(--text-heading)',margin:'24px 0 0'}}>О проекте</h2>
        <p style={{font:'var(--text-body)',color:'var(--text-primary)',margin:0,maxWidth:640}}>Двухэтажный дом с открытой гостиной-кухней, мастер-спальней и кабинетом. Планировку можно адаптировать под участок: перенести вход, добавить террасу или гараж.</p>
      </div>
      <aside style={{background:'#fff',border:'1px solid var(--border-default)',borderRadius:'var(--radius-lg)',boxShadow:'var(--shadow-card)',padding:24,display:'flex',flexDirection:'column',gap:16,position:'sticky',top:88}}>
        <StatusDot status="progress" label="Доступен к строительству"/>
        <div><span style={{font:'400 14px var(--font-body)',color:'var(--text-secondary)'}}>Стоимость под ключ</span><div style={{font:'700 32px var(--font-display)',color:'var(--text-heading)',fontVariantNumeric:'tabular-nums'}}>от {total.toLocaleString('ru-RU')} ₽</div></div>
        <div style={{borderTop:'1px solid var(--border-default)',paddingTop:16,display:'flex',flexDirection:'column',gap:12}}><span style={{font:'600 15px var(--font-display)',color:'var(--text-heading)'}}>Настройка проекта</span>
          {opts.map(([n,v])=><div key={n} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><Checkbox label={n} checked={!!sel[n]} onChange={c=>setSel({...sel,[n]:c})}/><span style={{font:'400 13px var(--font-body)',color:'var(--text-muted)',fontVariantNumeric:'tabular-nums'}}>+{v.toLocaleString('ru-RU')} ₽</span></div>)}
        </div>
        <Button size="lg" fullWidth iconRight="chevron-right" onClick={()=>go('contractor')}>Подобрать подрядчика</Button>
        <Button size="lg" fullWidth variant="secondary">Задать вопрос архитектору</Button>
      </aside>
    </div>
    <div style={{marginTop:48}}><SectionTitle>Подрядчики для этого проекта</SectionTitle><div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:20}}>{D.contractors.map(c=><ContractorCard key={c.id} {...c} onPrimary={()=>go('contractor')}/>)}</div></div>
  </Container>;
}
window.ProjectPage=ProjectPage;