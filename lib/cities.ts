export type PlacePhoto={imageUrl?:string;imagePageUrl?:string;imageCredit?:string;imageLicense?:string;imageLicenseUrl?:string;photoStatus?:'available'|'unavailable'|'retry';commonsFile?:string};
export const PLACE_DETAILS_VERSION=3;
export type PlaceLocation=import('./place-info.ts').PlaceInfo&{latitude?:number;longitude?:number;wikiTitle?:string;wikidataId?:string;locationVersion?:number;locationSourceUrl?:string;locationPrecision?:number;placeLookupManual?:boolean;placeDetailsVersion?:number};
export type CityPlace=PlacePhoto&PlaceLocation&import('./place-popularity.ts').PlacePopularity&{id:string;name:string;category:string;area:string;description:string;sourceUrl:string;sourceLabel:string;tags:string[]};
export type CityProfile={key:string;name:string;country:string;timezone:string;aliases:string[];places:CityPlace[]};
const tokyo=(id:string,name:string,category:string,area:string,description:string,path:string,tags:string[]):CityPlace=>({id:`tokyo-${id}`,name,category,area,description,sourceUrl:`https://www.gotokyo.org${path}`,sourceLabel:'GO TOKYO · official city guide',tags});
const busan=(id:string,name:string,category:string,area:string,description:string,url:string,tags:string[]):CityPlace=>({id:`busan-${id}`,name,category,area,description,sourceUrl:url,sourceLabel:'Visit Busan · official city guide',tags});
export const cityProfiles:CityProfile[]=[
 {key:'tokyo',name:'Tokyo',country:'Japan',timezone:'Asia/Tokyo',aliases:['tokyo','tokyo japan','tokyo, japan','tokyo, jp','東京','東京都','东京'],places:[
  tokyo('sensoji','Senso-ji Temple','Activity','Asakusa, Tokyo','Explore the temple grounds and the nearby Nakamise shopping street.','/en/spot/15/index.html',['Culture','Outdoors']),
  tokyo('meiji','Meiji Jingu','Activity','Shibuya, Tokyo','Take the forested approach to this shrine near Harajuku.','/en/spot/76/index.html',['Culture','Outdoors']),
  tokyo('gyoen','Shinjuku Gyoen National Garden','Activity','Shinjuku, Tokyo','Plan a quieter stop among the garden’s different landscapes.','/en/spot/75/index.html',['Nature','Outdoors']),
  tokyo('tsukiji','Tsukiji Outer Market','Meal','Tsukiji, Tokyo','Browse food shops and choose a meal at the outer market.','/en/spot/65/',['Food','Shopping']),
  tokyo('shibuya','Shibuya Scramble Crossing','Activity','Shibuya, Tokyo','Explore the crossing and the surrounding Shibuya district.','/en/spot/78/index.html',['City walk','Outdoors']),
  tokyo('ueno','Ueno Park & museum district','Activity','Ueno, Tokyo','Combine a park walk with a museum visit of your choice.','/en/destinations/northern-tokyo/ueno/index.html',['Nature','Culture'])
 ]},
 {key:'busan',name:'Busan',country:'South Korea',timezone:'Asia/Seoul',aliases:['busan','pusan','busan south korea','busan, south korea','busan, korea','busan, kr','부산','부산광역시','釜山'],places:[
  busan('gamcheon','Gamcheon Culture Village','Activity','Gamcheon, Busan','Explore the hillside village’s lanes and cultural stops.','https://www.visitbusan.net/index.do?lang_cd=en+&menuCd=DOM_000000301001001000&uc_seq=365',['Culture','Outdoors']),
  busan('haeundae','Haeundae Beach','Activity','Haeundae, Busan','Add a coastal walk and time around the Haeundae waterfront.','https://www.visitbusan.net/index.do?lang_cd=en&menuCd=DOM_000000601001001000&uc_seq=373',['Beach','Outdoors']),
  busan('gwangalli','Gwangalli Beach','Activity','Gwangalli, Busan','Explore the beach and its views of Gwangandaegyo Bridge.','https://www.visitbusan.net/index.do?contentsSid=22&lang_cd=en&uc_seq=377',['Beach','Outdoors']),
  busan('jagalchi','Jagalchi Market','Meal','Nampo, Busan','Browse the fish market and choose a seafood meal if it suits the group.','https://www.visitbusan.net/archive/eng/dataSearchEng/view.nm?dataSid=METADATA004615&menuCd=37',['Food','Shopping']),
  busan('yonggungsa','Haedong Yonggungsa Temple','Activity','Gijang, Busan','Visit the coastal temple, allowing time for the steps and sea views.','https://www.visitbusan.net/en/index.do?lang_cd=en&menuCd=DOM_000000303011001000&uc_seq=261',['Culture','Outdoors'])
 ]}
];
export const cityKey=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export function cityProfile(destination:string,selected?:{name:string;country:string}){return cityProfiles.find(p=>p.aliases.includes(cityKey(destination))||(selected&&p.aliases.includes(cityKey(`${selected.name}, ${selected.country}`))));}
export function suggestedTimezone(destination:string){return cityProfile(destination)?.timezone??'America/Toronto';}
