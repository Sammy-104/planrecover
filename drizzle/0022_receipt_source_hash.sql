ALTER TABLE `receipt_objects` ADD `source_sha256` text;
--> statement-breakpoint
-- Legacy objects retain NULL: a later backup cannot establish their original digest.
CREATE TRIGGER receipt_source_hash_valid_insert BEFORE INSERT ON receipt_objects
WHEN NEW.source_sha256 IS NOT NULL AND (length(NEW.source_sha256)<>64 OR NEW.source_sha256 GLOB '*[^0-9a-f]*')
BEGIN SELECT RAISE(ABORT,'Invalid original receipt digest'); END;
--> statement-breakpoint
CREATE TRIGGER receipt_source_hash_immutable BEFORE UPDATE OF source_sha256 ON receipt_objects
WHEN NEW.source_sha256 IS NOT OLD.source_sha256
BEGIN SELECT RAISE(ABORT,'Original receipt digest is immutable'); END;
