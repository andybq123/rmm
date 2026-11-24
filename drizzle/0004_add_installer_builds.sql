CREATE TABLE `installer_builds` (
  `id` text PRIMARY KEY NOT NULL,
  `site_name` text DEFAULT '' NOT NULL,
  `domain` text DEFAULT '' NOT NULL,
  `installer_file_name` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'building' NOT NULL,
  `size_bytes` integer DEFAULT 0 NOT NULL,
  `error` text DEFAULT '' NOT NULL,
  `log_tail` text DEFAULT '' NOT NULL,
  `created_by` text DEFAULT '' NOT NULL,
  `created_at` integer NOT NULL,
  `finished_at` integer
);
