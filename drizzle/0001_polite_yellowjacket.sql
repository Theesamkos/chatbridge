CREATE TABLE `audit_logs` (
	`id` varchar(36) NOT NULL,
	`eventType` varchar(128) NOT NULL,
	`userId` int,
	`conversationId` varchar(36),
	`pluginId` varchar(64),
	`payload` json NOT NULL,
	`severity` enum('info','warning','error','critical') NOT NULL DEFAULT 'info',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`title` text,
	`activePluginId` varchar(64),
	`status` enum('active','archived','frozen') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` varchar(36) NOT NULL,
	`conversationId` varchar(36) NOT NULL,
	`role` enum('user','assistant','tool_use','tool_result','system') NOT NULL,
	`content` text NOT NULL,
	`toolName` varchar(128),
	`toolCallId` varchar(128),
	`moderationStatus` enum('pending','passed','flagged','blocked') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `plugin_failures` (
	`id` varchar(36) NOT NULL,
	`pluginId` varchar(64) NOT NULL,
	`conversationId` varchar(36) NOT NULL,
	`failureType` enum('timeout','load_failure','invalid_origin','malformed_state','tool_error','circuit_breaker') NOT NULL,
	`errorDetail` text NOT NULL,
	`resolved` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `plugin_failures_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `plugin_schemas` (
	`id` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` text NOT NULL,
	`origin` varchar(512) NOT NULL,
	`iframeUrl` varchar(512) NOT NULL,
	`toolSchemas` json NOT NULL,
	`manifest` json NOT NULL,
	`status` enum('active','disabled','suspended') NOT NULL DEFAULT 'active',
	`allowedRoles` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `plugin_schemas_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `plugin_states` (
	`id` varchar(36) NOT NULL,
	`conversationId` varchar(36) NOT NULL,
	`pluginId` varchar(64) NOT NULL,
	`state` json NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `plugin_states_id` PRIMARY KEY(`id`),
	CONSTRAINT `plugin_states_conversation_plugin_unique` UNIQUE(`conversationId`,`pluginId`)
);
--> statement-breakpoint
CREATE TABLE `safety_events` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`conversationId` varchar(36) NOT NULL,
	`eventType` enum('input_blocked','output_flagged','injection_detected','session_frozen','content_filtered') NOT NULL,
	`triggerContent` text NOT NULL,
	`action` enum('blocked','sanitized','flagged_for_review','session_frozen') NOT NULL,
	`reviewedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `safety_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `audit_logs_userId_idx` ON `audit_logs` (`userId`);--> statement-breakpoint
CREATE INDEX `audit_logs_conversationId_idx` ON `audit_logs` (`conversationId`);--> statement-breakpoint
CREATE INDEX `audit_logs_eventType_idx` ON `audit_logs` (`eventType`);--> statement-breakpoint
CREATE INDEX `conversations_userId_idx` ON `conversations` (`userId`);--> statement-breakpoint
CREATE INDEX `conversations_activePluginId_idx` ON `conversations` (`activePluginId`);--> statement-breakpoint
CREATE INDEX `messages_conversationId_idx` ON `messages` (`conversationId`);--> statement-breakpoint
CREATE INDEX `messages_toolCallId_idx` ON `messages` (`toolCallId`);--> statement-breakpoint
CREATE INDEX `plugin_failures_pluginId_idx` ON `plugin_failures` (`pluginId`);--> statement-breakpoint
CREATE INDEX `plugin_failures_conversationId_idx` ON `plugin_failures` (`conversationId`);--> statement-breakpoint
CREATE INDEX `plugin_states_conversationId_idx` ON `plugin_states` (`conversationId`);--> statement-breakpoint
CREATE INDEX `plugin_states_pluginId_idx` ON `plugin_states` (`pluginId`);--> statement-breakpoint
CREATE INDEX `safety_events_userId_idx` ON `safety_events` (`userId`);--> statement-breakpoint
CREATE INDEX `safety_events_conversationId_idx` ON `safety_events` (`conversationId`);