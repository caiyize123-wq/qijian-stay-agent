// Separate property pack, researched from Hyatt official pages on 2026-10-19.
const base='https://www.hyatt.com/andaz/en-US/xmnaz-andaz-xiamen';
export const hotel={id:'andaz-xiamen',name:'厦门安达仕酒店',shortName:'安达仕',english:'ANDAZ XIAMEN',city:'厦门市',address:'厦门市思明区湖滨东路101号',phone:'0592-3661234',source:base,checkedAt:'2026-10-19',keyword:'厦门安达仕',nearbyKeyword:'厦门万象城',cover:'space',mood:'都市南洋',notice:'独立产品样例，非酒店官方服务。',mapNotice:'空间关系示意，非酒店实际平面图；路线未经现场核验，不用于现场指路。',contacts:{tea:{name:'安达仕酒廊',phone:'0592-3681234'},xia:{name:'壹佰零壹号中餐厅',phone:'0592-3663779'}},sources:[{name:'酒店与设计',url:base},{name:'餐饮与营业时间',url:base+'/dining'},{name:'设施与楼层',url:base+'/faqs'}]};
const common={image:'space',fee:'费用与入住权益请向酒店咨询',booking:'联系酒店了解参与条件',windows:null};
export const places=[
 { ...common,id:'arrival',name:'酒店大堂',english:'ARRIVAL',category:'architecture',tag:'抵达',intro:'从大堂开始认识这家南洋风格酒店。',story:'官网介绍酒店由JID设计，融合厦门南洋文化。空间画面为产品视觉示意。',prompt:'留意公共空间中的南洋风格元素。',duration:15,location:'大堂，入口请向前台询问',source:base,x:190,y:400},
 { ...common,id:'garden',name:'南洋空间',english:'NANYANG SPACES',category:'architecture',tag:'建筑',intro:'从酒店的南洋风格，认识厦门的另一面。',story:'凯悦官网将酒店描述为现代南洋风格宅邸，设计与厦门侨乡文化相联系。画面为产品视觉示意。',prompt:'看看不同公共空间如何使用自然材质。',duration:25,location:'酒店公共区域',source:base,x:355,y:285},
 { ...common,id:'tea',name:'安达仕酒廊',english:'ANDAZ LOUNGE',category:'dining',tag:'茶与咖啡',intro:'在天光下喝一杯福建茶或手冲咖啡。',story:'官网介绍酒廊提供轻食、下午茶、福建茶与手冲咖啡。画面为产品视觉示意。',prompt:'先从一杯茶或咖啡开始。',duration:45,windows:[[600,1320]],location:'安达仕酒廊',source:base+'/dining',x:515,y:325},
 { ...common,id:'xia',name:'壹佰零壹号中餐厅',english:'NO. 101',category:'dining',tag:'闽南风味',intro:'一餐闽南风味，继续认识这座城市。',story:'官网介绍餐厅提供闽南风味，设有开放式厨房。画面为产品视觉示意。',prompt:'向餐厅了解今天的菜单。',duration:75,windows:[[390,630],[690,870],[1050,1290]],location:'壹佰零壹号中餐厅',source:base+'/dining',x:700,y:255},
 { ...common,id:'pool',name:'室外恒温泳池',english:'OUTDOOR POOL',category:'wellness',tag:'泳池',intro:'给自己留一段水边时光。',story:'凯悦官方FAQ介绍酒店有室外恒温泳池，位于L层。当前营业时段未取得。画面为产品视觉示意。',prompt:'带好泳装，出发前了解当天开放情况。',duration:45,location:'L层',source:base+'/faqs',x:750,y:455},
 { ...common,id:'andaz-spa',name:'水疗护理',english:'SPA TREATMENTS',category:'wellness',kind:'spa',tag:'身心放松',
   intro:'酒店官网列有水疗服务，可先向前台了解护理项目。',story:'凯悦官方FAQ明确列有酒店内水疗护理，可由前台协助预约。具体项目、营业时段、费用与地点未取得，不沿用其他酒店资料。',
   prompt:'联系前台确认护理内容、时段和费用，再决定是否安排。',duration:60,requiresCostConfirmation:true,location:'酒店内，具体楼层与入口未取得',
   source:base+'/faqs',sourceCheckedAt:'2026-10-20',mapAvailable:false,x:null,y:null },
 { ...common,id:'gym',name:'健身中心',english:'FITNESS',category:'wellness',tag:'运动',intro:'旅行中，也保留熟悉的运动节奏。',story:'凯悦官方FAQ介绍健身中心位于2层，每日开放；未取得具体营业小时。画面为产品视觉示意。',prompt:'按自己的习惯选择运动强度。',duration:40,location:'2层',source:base+'/faqs',x:325,y:535},
];
export const guideChapters=[
 {id:'nanyang',pointId:'garden',number:'01',title:'发现南洋',subtitle:'从空间开始认识厦门。',image:'space',hotspot:{x:50,y:45},observation:'走进南洋风格的公共空间，再到酒廊坐一会儿。',fact:'凯悦官网介绍，酒店由JID设计，融合厦门侨乡与南洋文化。',boundary:'空间画面为产品视觉示意，非酒店实景；通行范围以酒店现场为准。',source:base,next:['tea','pool']},
 {id:'lounge',pointId:'tea',number:'02',title:'一杯福建茶',subtitle:'留一点时间给自己。',image:'space',hotspot:{x:50,y:45},observation:'酒廊里有福建茶、手冲咖啡与轻食，可以从一杯饮品开始。',fact:'酒廊官网营业时段为10:00—22:00。',boundary:'空间画面为产品视觉示意；菜单、座位及消费要求以酒店说明为准。',source:base+'/dining',next:['xia','garden']},
 {id:'water',pointId:'pool',number:'03',title:'水边放空',subtitle:'换一个节奏。',image:'space',hotspot:{x:50,y:45},observation:'把一段空闲留给室外恒温泳池。',fact:'凯悦官方FAQ标注室外恒温泳池位于L层。',boundary:'空间画面为产品视觉示意；当前开放情况需联系酒店。',source:base+'/faqs',next:['tea','gym']},
];
