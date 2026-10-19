CREATE UNIQUE INDEX controlled_reminder_email_once ON adapter_operations
 (owner,plan_id,member_id,json_extract(request,'$.sourceJobId')) WHERE provider='aws-ses' AND kind='controlled-self-test';
--> statement-breakpoint
CREATE TRIGGER controlled_reminder_email_valid BEFORE INSERT ON adapter_operations
WHEN NEW.kind='controlled-self-test' AND (NEW.provider<>'aws-ses' OR NOT json_valid(NEW.request)
 OR json_type(NEW.request,'$.sourceJobId') IS NOT 'text' OR length(json_extract(NEW.request,'$.sourceJobId'))<1
 OR json_type(NEW.request,'$.grantHash') IS NOT 'text' OR json_extract(NEW.request,'$.consent') IS NOT 'one-manual-self-email-copy')
BEGIN SELECT RAISE(ABORT,'Controlled reminder test needs an immutable saved source and manual consent'); END;
--> statement-breakpoint
CREATE TRIGGER controlled_reminder_email_immutable BEFORE UPDATE OF id,owner,plan_id,member_id,provider,kind,request,created ON adapter_operations
WHEN OLD.kind='controlled-self-test' OR NEW.kind='controlled-self-test'
BEGIN SELECT RAISE(ABORT,'Controlled reminder test authorization and source are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER controlled_reminder_email_retained BEFORE DELETE ON adapter_operations
WHEN OLD.kind='controlled-self-test'
BEGIN SELECT RAISE(ABORT,'Controlled reminder test attempts are retained to prevent resending'); END;
