import type {CityStay} from './city-stays.ts';
import type {RoadTripSettings} from './road-trip.ts';
import type {PlanningCosts} from './traveller-planning.ts';
import type {PlanningIdea} from './idea-collections.ts';
import type {TripScenario} from './trip-workbench.ts';
import type {ActivityDecisions} from './activity-decisions.ts';
import type {ReminderSettings,ReminderState} from './reminders.ts';
import type {CityPlace} from './cities.ts';
import type {CancellationTerms} from './plan-recovery.ts';

/** Additive UI planning metadata. Canonical financial facts remain in the
 * existing ledger, approvals and provider services. */
export type FrontendPlan={stays?:CityStay[];roadTrip?:RoadTripSettings;scenarios?:TripScenario[];planningIdeas?:PlanningIdea[];planningCosts?:PlanningCosts};
export type FrontendItem={cancellationTerms?:CancellationTerms;stayId?:string;timezone?:string;ideaId?:string;bookingEndDate?:string;bookingImportId?:string;externalBooking?:string;financialOnly?:boolean;sourceUrl?:string;insertionCheck?:{travelIn:number;travelOut:number;buffer:number;travelStatus:string;issues:string[]}};
export type FrontendSuggestion={cityKey?:string;stayId?:string;timezone?:string;routeLegId?:string};
export type FrontendPreferences={travelBuffer?:number;queueMinutes?:number;restMinutes?:number;maxWalkMinutes?:number;mobility?:'any'|'step-free'|'short-walks';availableFrom?:string;availableTo?:string;currency?:string;publicOnly?:boolean;cashLimitSet?:boolean;dietary?:string;reminders?:ReminderSettings;reminderState?:Record<string,ReminderState>};
export type FrontendState={cityRecommendations?:Record<string,{destinationKey:string;resolvedCity:string;fetchedAt:string;source:'city-guide'|'wikipedia'|'open-places';entries:CityPlace[];radiusKm?:number;photosChecked?:boolean;detailsVersion?:number;discoveryVersion?:number;sourcesUnavailable?:boolean;searchPoint?:{latitude:number;longitude:number}}>;routeCatalog?:(CityPlace&{routeLegId:string;timezone:string})[];activityDecisions?:ActivityDecisions;appliedDrafts?:string[];bookingImports?:string[]};
