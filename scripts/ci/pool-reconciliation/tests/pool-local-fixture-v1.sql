-- SYNTHETIC LOCAL POSTGRES ONLY; mounted into a new internal-network container.
CREATE ROLE crm_runtime LOGIN PASSWORD 'synthetic-local-only';
CREATE TABLE public.campus_assignment_configurations(campus_id uuid PRIMARY KEY, version integer NOT NULL);
CREATE TABLE public.campus_assignment_versions(campus_id uuid NOT NULL, version integer NOT NULL, actor_id text NOT NULL, created_at timestamptz NOT NULL, rules jsonb NOT NULL);
CREATE TABLE public.audit_events(id uuid PRIMARY KEY,campus_id text,resource_type text,resource_id text,event_type text,actor_id text,actor_roles jsonb,correlation_id text,idempotency_key text,occurred_at timestamptz,result text,"before" jsonb,minimized_ip text,session_id text,"after" jsonb);
CREATE TABLE public.campus_new_assignment_counters(campus_id uuid,version integer,rule_id text,user_id uuid,assigned_count integer);
CREATE TABLE public.crm_references(id uuid PRIMARY KEY,kind text,code text,state text,scope text,campus_id uuid);
INSERT INTO public.campus_assignment_configurations VALUES('00000000-0000-0000-0000-000000000001',1);
INSERT INTO public.campus_assignment_versions VALUES('00000000-0000-0000-0000-000000000001',1,'00000000-0000-0000-0000-000000000003',clock_timestamp(),'{"syntheticLocalOnly":true}');
INSERT INTO public.audit_events VALUES('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','ASSIGNMENT_CONFIGURATION','00000000-0000-0000-0000-000000000001','CAMPUS_ASSIGNMENT_CONFIGURED','00000000-0000-0000-0000-000000000003','["SUPER_ADMIN"]','synthetic-local','synthetic-local',clock_timestamp(),'SUCCESS',null,null,null,'{"syntheticLocalOnly":true}');
INSERT INTO public.campus_new_assignment_counters VALUES('00000000-0000-0000-0000-000000000001',1,'synthetic-rule','00000000-0000-0000-0000-000000000003',7);
INSERT INTO public.crm_references VALUES('00000000-0000-0000-0000-000000000001','CAMPUS','SYNTHETIC','ACTIVE',null,null),('00000000-0000-0000-0000-000000000002','CAMPAIGN','SYNTHETIC','ACTIVE','CAMPUS','00000000-0000-0000-0000-000000000001');
GRANT CONNECT ON DATABASE crmynov_prod TO crm_runtime;
GRANT USAGE ON SCHEMA public TO crm_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO crm_runtime;
