export const DISCOVERY_VERSION=5;
export const CITY_CATALOG_LIMIT=1800;
export const discoveryTopics=['Landmarks','Museums','Outdoors','Food','Shopping','Entertainment'] as const;
export type DiscoveryTopic=typeof discoveryTopics[number];
// These are browseable venue types, not invented tours, classes or bookable offers.
export const discoveryCollections=[
 {id:'cafes',label:'Cafes & tea',topic:'Food',terms:'(cafe OR coffee OR tea house)',pattern:/\b(cafes?|coffee|tea houses?|tea rooms?)\b/},
 {id:'sweets',label:'Bakeries & sweets',topic:'Food',terms:'(bakery OR pastry OR chocolate OR ice cream)',pattern:/\b(bakeries|bakery|pastry|desserts?|sweets?|chocolate|ice cream)\b/},
 {id:'markets',label:'Markets',topic:'Shopping',terms:'(market OR bazaar)',pattern:/\b(markets?|bazaars?)\b/},
 {id:'escape',label:'Escape rooms',topic:'Entertainment',terms:'(escape room OR escape game)',pattern:/\b(escape rooms?|escape games?)\b/},
 {id:'arcades',label:'Arcades & game shops',topic:'Entertainment',terms:'(arcade OR game shop OR board games)',pattern:/\b(arcades?|game shops?|board games?)\b/},
 {id:'climbing',label:'Climbing & bouldering',topic:'Entertainment',terms:'(climbing OR bouldering)',pattern:/\b(climbing|bouldering)\b/},
 {id:'bowling',label:'Bowling',topic:'Entertainment',terms:'(bowling)',pattern:/\b(bowling)\b/},
 {id:'golf',label:'Mini & disc golf',topic:'Entertainment',terms:'(miniature golf OR mini golf OR disc golf)',pattern:/\b(miniature golf|mini golf|disc golf)\b/},
 {id:'skating',label:'Skating',topic:'Entertainment',terms:'(skating OR ice rink OR skatepark)',pattern:/\b(skating|ice rinks?|skateparks?)\b/},
 {id:'performance',label:'Music & theatre',topic:'Entertainment',terms:'(music venue OR theatre OR theater)',pattern:/\b(live music|music venues?|theatres?|theaters?)\b/},
 {id:'vintage',label:'Vintage & antiques',topic:'Shopping',terms:'(vintage shop OR antique shop OR thrift store)',pattern:/\b(vintage|antiques?|thrift|second hand)\b/},
 {id:'books',label:'Books & comics',topic:'Shopping',terms:'(bookshop OR bookstore OR comic shop)',pattern:/\b(books?|bookshops?|bookstores?|comics?|manga|anime)\b/},
 {id:'records',label:'Records & music shops',topic:'Shopping',terms:'(record shop OR music store)',pattern:/\b(records?|vinyl|music shops?|music stores?|musical instruments?)\b/},
 {id:'arts',label:'Galleries & crafts',topic:'Museums',terms:'(gallery OR art shop OR craft shop)',pattern:/\b(galleries|gallery|crafts?|art shops?)\b/},
 {id:'gardens',label:'Gardens',topic:'Outdoors',terms:'(garden OR botanical)',pattern:/\b(gardens?|botanical)\b/},
 {id:'viewpoints',label:'Viewpoints',topic:'Landmarks',terms:'(viewpoint OR observation deck OR lookout)',pattern:/\b(viewpoints?|observation decks?|lookouts?)\b/},
 {id:'streetart',label:'Street art',topic:'Landmarks',terms:'(street art OR mural OR sculpture)',pattern:/\b(street art|murals?|sculptures?)\b/},
 {id:'swimming',label:'Beaches & swimming',topic:'Outdoors',terms:'(beach OR swimming pool OR swimming area)',pattern:/\b(beaches?|swimming|swimming pools?)\b/},
 {id:'historic',label:'Historic sites',topic:'Landmarks',terms:'(historic site OR monument OR ruins OR archaeological)',pattern:/\b(historic sites?|historical sites?|monuments?|ruins?|archaeological sites?)\b/},
 {id:'castles',label:'Castles & palaces',topic:'Landmarks',terms:'(castle OR palace OR fort)',pattern:/\b(castles?|palaces?|forts?)\b/},
 {id:'worship',label:'Temples & churches',topic:'Landmarks',terms:'(temple OR shrine OR church OR cathedral OR mosque)',pattern:/\b(temples?|shrines?|churches|church|cathedrals?|mosques?)\b/},
 {id:'nature',label:'Nature reserves',topic:'Outdoors',terms:'(nature reserve OR national park)',pattern:/\b(nature reserves?|national parks?|protected areas?)\b/},
 {id:'waterfalls',label:'Waterfalls',topic:'Outdoors',terms:'(waterfall)',pattern:/\b(waterfalls?)\b/},
 {id:'caves',label:'Peaks & caves',topic:'Outdoors',terms:'(mountain peak OR cave)',pattern:/\b(peaks?|caves?|cave entrances?|mountains?)\b/},
 {id:'family',label:'Playgrounds',topic:'Outdoors',terms:'(playground)',pattern:/\b(playgrounds?|play areas?)\b/},
 {id:'animals',label:'Zoos & aquariums',topic:'Entertainment',terms:'(zoo OR aquarium OR oceanarium)',pattern:/\b(zoos?|aquariums?|oceanariums?)\b/},
 {id:'themeparks',label:'Theme & water parks',topic:'Entertainment',terms:'(theme park OR amusement park OR water park)',pattern:/\b(theme parks?|amusement parks?|water parks?)\b/},
 {id:'cinemas',label:'Cinemas',topic:'Entertainment',terms:'(cinema OR movie theatre)',pattern:/\b(cinemas?|movie theatres?|movie theaters?)\b/},
 {id:'wellness',label:'Spas & saunas',topic:'Entertainment',terms:'(spa OR sauna OR public bath)',pattern:/\b(spas?|saunas?|public baths?|bathhouses?)\b/},
 {id:'sports',label:'Sports & recreation',topic:'Entertainment',terms:'(sports centre OR stadium OR recreation centre)',pattern:/\b(sports centres?|sports centers?|stadiums?|recreation centres?|recreation centers?)\b/}
] as const satisfies readonly {id:string;label:string;topic:DiscoveryTopic;terms:string;pattern:RegExp}[];
export type DiscoveryCollection=typeof discoveryCollections[number];
export const foldPlaceName=(value:string)=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function activityWords(input:string,city:string){
 const cityWords=new Set(foldPlaceName(city).split(' '));
 return foldPlaceName(input).replace(/\b(things to do|places to visit|near me)\b/g,' ').split(/\s+/).filter(word=>(word.length>1||/^\d+$/.test(word))&&!cityWords.has(word)&&!['activities','activity','attractions','best','popular','fun','find','search','show','visit','in','near','around','the','an','some','for','to','me'].includes(word));
}
export function discoveryTopic(input:string,city:string):DiscoveryTopic|undefined{
 const collection=discoveryCollection(input,city);if(collection)return collection.topic;
 const query=activityWords(input,city).join(' ');
 const patterns:[RegExp,DiscoveryTopic][]=[[/^(food|eat|eating|dining|restaurants?|cafes?|coffee|bars?|pubs?)$/,'Food'],[/^(walks?|walking|hikes?|hiking|nature|outdoors?|parks?|gardens?|beaches?|swimming)$/,'Outdoors'],[/^(shops?|shopping|markets?|malls?)$/,'Shopping'],[/^(museums?|art|galleries?|art museums?|art galleries?)$/,'Museums'],[/^(sights?|sightseeing|landmarks?|temples?|shrines?|monuments?|castles?)$/,'Landmarks'],[/^(entertainment|cinemas?|theatres?|theaters?|zoos?|aquariums?|theme parks?|amusement parks?|bowling|nightlife)$/,'Entertainment']];
 return patterns.find(([pattern])=>pattern.test(query))?.[1];
}

export function discoveryCollection(input:string,city=''):DiscoveryCollection|undefined{
 const queries=[foldPlaceName(input),activityWords(input,city).join(' ')];
 // Full category phrases only: a venue called "Escape Room Cafe" still uses named search.
 return discoveryCollections.find(c=>queries.some(query=>query===foldPlaceName(c.label)||new RegExp(`^(?:${c.pattern.source.replace(/^\\b|\\b$/g,'')})(?: shops?| stores?| venues?)?$`).test(query)));
}
export function textCollectionTags(text:string){const folded=foldPlaceName(text);return discoveryCollections.filter(c=>c.pattern.test(folded)).map(c=>c.label);}
export function matchesDiscoverySearch(place:{name:string;description:string;tags:readonly string[]},input:string,city:string){
 if(!input)return true;
 const collection=discoveryCollection(input,city);if(collection)return place.tags.includes(collection.label)||textCollectionTags(`${place.name} ${place.description}`).includes(collection.label);
 const topic=discoveryTopic(input,city);if(topic)return place.tags.includes(topic);
 return matchesPlaceName(place.name,activityWords(input,city));
}

export function matchesPlaceName(value:string,words:string[]){
 const tokens=foldPlaceName(value).split(' ');let start=0;
 for(const word of words){const found=tokens.findIndex((token,index)=>index>=start&&token.startsWith(word));if(found<0)return false;start=found+1;}
 return words.length>0;
}
