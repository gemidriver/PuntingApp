-- Migration: Add email_reminders preference to profiles table
-- Run this in the Supabase SQL editor.

-- Add the column (defaults to true so existing users keep receiving emails)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_reminders boolean NOT NULL DEFAULT true;

-- Allow users to update their own email_reminders flag
-- (assumes RLS is enabled on profiles)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'Users can update own email_reminders'
  ) THEN
    CREATE POLICY "Users can update own email_reminders"
      ON public.profiles
      FOR UPDATE
      USING (id = auth.uid())
      WITH CHECK (id = auth.uid());
  END IF;
END
$$;
