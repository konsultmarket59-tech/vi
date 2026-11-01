Room schedule («Экспликация помещений») for floor plans, sketch-project sheets and site screenshots.
```jsx
<Explication groups={[{title:'1 этаж',rooms:[{n:1,name:'Кабинет',area:11.7},{n:5,name:'Санузел',area:10.2,wet:true}]}]}/>
```
Total is computed from rows unless `total` given — it must match the plan header. variant="sheet" for ЭП sheets (no shadow/radius).