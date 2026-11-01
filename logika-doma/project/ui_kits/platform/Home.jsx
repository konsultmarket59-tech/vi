function Home({go}){
  const {Button,Select,Input,StepPath,ProjectCard,ContractorCard,Icon}=NSX;const D=window.LD_DATA;
  return <div>
    <section style={{position:'relative',overflow:'hidden',background:'linear-gradient(180deg,#fff 0%,var(--surface-soft) 100%)',borderBottom:'1px solid var(--border-default)'}}>
      <div style={{position:'absolute',inset:0,...gridBg,opacity:.7}}><Nodes nodes={[[2,1,'cyan'],[9,1,'blue'],[5,2,'navy'],[1,4,'orange'],[12,3,'coral'],[16,1,'cool-gray'],[18,4,'cyan']]}/></div>
      <Container style={{position:'relative',display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)',gap:40,alignItems:'center',padding:'72px 32px 40px'}}>
        <div>
          <h1 style={{margin:0,font:'var(--text-display)',color:'var(--text-heading)',letterSpacing:'var(--ls-heading)',textWrap:'balance'}}>Выберите дом. Продумайте детали. Найдите подрядчика.</h1>
          <p style={{font:'300 20px/1.5 var(--font-body)',color:'var(--text-secondary)',margin:'20px 0 28px'}}>Логика. Проекты. Подрядчики.</p>
          <div style={{display:'flex',gap:12}}><Button size="lg" iconRight="chevron-right" onClick={()=>go('catalog')}>Выбрать проект</Button><Button size="lg" variant="secondary" onClick={()=>go('contractor')}>Найти подрядчика</Button></div>
        </div>
        <img src="../../assets/images/house-04.png" alt="" style={{width:'100%',aspectRatio:'4/3',objectFit:'cover',borderRadius:'var(--radius-xl)',boxShadow:'var(--shadow-pop)'}}/>
      </Container>
      <Container style={{position:'relative',paddingBottom:48}}>
        <div style={{background:'#fff',border:'1px solid var(--border-default)',borderRadius:'var(--radius-lg)',boxShadow:'var(--shadow-card)',padding:16,display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr)) auto',gap:12,alignItems:'end'}}>
          <Select label="Тип дома" options={['Коттедж','Дуплекс','Таунхаус','Баня']}/><Select label="Площадь" options={['до 100 м²','100–150 м²','150–200 м²','от 200 м²']}/><Select label="Этажность" options={['1 этаж','2 этажа','Мансарда']}/><Select label="Бюджет" options={['до 4 млн ₽','4–6 млн ₽','6–10 млн ₽']}/>
          <Button onClick={()=>go('catalog')} icon="search">Найти</Button>
        </div>
      </Container>
    </section>
    <Container style={{padding:'64px 32px 0'}}>
      <SectionTitle>5 шагов к дому</SectionTitle>
      <div style={{background:'#fff',border:'1px solid var(--border-default)',borderRadius:'var(--radius-lg)',padding:'28px 32px'}}><StepPath current={0}/></div>
    </Container>
    <Container style={{padding:'64px 32px 0'}}>
      <SectionTitle action={<NSX.Button variant="tertiary" iconRight="arrow-right" onClick={()=>go('catalog')}>Все проекты</NSX.Button>}>Популярные проекты</SectionTitle>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:20}}>{D.projects.slice(0,3).map(p=><ProjectCard key={p.id} {...p} onOpen={()=>go('project',p.id)}/>)}</div>
    </Container>
    <Container style={{padding:'64px 32px 0'}}>
      <SectionTitle>Проверенные подрядчики</SectionTitle>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:20}}>{D.contractors.map(c=><ContractorCard key={c.id} {...c} primaryLabel={c.avatar?null:'Связаться'} secondaryLabel={c.avatar?'Профиль':undefined} onPrimary={()=>go('contractor')} onSecondary={()=>go('contractor')}/>)}</div>
    </Container>
    <Container style={{padding:'64px 32px 0'}}>
      <div style={{position:'relative',overflow:'hidden',background:'var(--ld-navy)',borderRadius:'var(--radius-xl)',padding:'48px 56px',color:'#fff'}}>
        <div style={{position:'absolute',inset:0,backgroundImage:'linear-gradient(rgba(255,255,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.07) 1px,transparent 1px)',backgroundSize:'64px 64px'}}><Nodes dark nodes={[[11,1,'cyan'],[14,2,'blue'],[16,1,'orange'],[13,3,'coral']]}/></div>
        <div style={{position:'relative',maxWidth:520}}><h2 style={{margin:0,font:'var(--text-h2)'}}>Найдите проект или создайте свой</h2><p style={{font:'var(--text-body)',opacity:.85,margin:'12px 0 24px'}}>Настройте планировку, материалы и инженерию — смета пересчитается автоматически.</p><Button variant="secondary" onClick={()=>go('catalog')}>Подобрать проект</Button></div>
      </div>
    </Container>
  </div>;
}
window.Home=Home;