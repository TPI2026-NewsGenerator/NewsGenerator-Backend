--
-- PostgreSQL database dump
--


-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3

-- Started on 2026-05-11 09:23:44

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 220 (class 1259 OID 16410)
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id integer CONSTRAINT categories_list_id_not_null NOT NULL,
    category_name text NOT NULL
);


--
-- TOC entry 222 (class 1259 OID 16452)
-- Name: categories_list_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.categories ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.categories_list_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 227 (class 1259 OID 16931)
-- Name: custom_searches_has_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_searches_has_categories (
    id integer CONSTRAINT "custom-searches_has_categories_id_not_null" NOT NULL,
    id_custom_search integer CONSTRAINT "custom-searches_has_categories_id_custom-search_not_null" NOT NULL,
    id_category integer CONSTRAINT "custom-searches_has_categories_id_category_not_null" NOT NULL
);


--
-- TOC entry 228 (class 1259 OID 16973)
-- Name: custom-searches_has_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.custom_searches_has_categories ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."custom-searches_has_categories_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 226 (class 1259 OID 16846)
-- Name: custom_searches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_searches (
    id integer CONSTRAINT history_id_not_null NOT NULL,
    id_user integer CONSTRAINT "custom-searches_id_user_not_null" NOT NULL,
    title text CONSTRAINT "custom-searches_title_not_null" NOT NULL,
    language text CONSTRAINT "custom-searches_language_not_null" NOT NULL,
    timeframe text CONSTRAINT "custom-searches_timeframe_not_null" NOT NULL,
    keyword text NOT NULL
);


--
-- TOC entry 225 (class 1259 OID 16845)
-- Name: history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.custom_searches ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 224 (class 1259 OID 16520)
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id integer CONSTRAINT roles_list_id_not_null NOT NULL,
    role text NOT NULL
);


--
-- TOC entry 223 (class 1259 OID 16519)
-- Name: roles_list_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.roles ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.roles_list_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 219 (class 1259 OID 16389)
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username text NOT NULL,
    email text NOT NULL,
    password text NOT NULL,
    role integer NOT NULL
);


--
-- TOC entry 221 (class 1259 OID 16437)
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 5048 (class 0 OID 16410)
-- Dependencies: 220
-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.categories (id, category_name) OVERRIDING SYSTEM VALUE VALUES (1, 'world');
INSERT INTO public.categories (id, category_name) OVERRIDING SYSTEM VALUE VALUES (2, 'press');
INSERT INTO public.categories (id, category_name) OVERRIDING SYSTEM VALUE VALUES (3, 'sport');


--
-- TOC entry 5054 (class 0 OID 16846)
-- Dependencies: 226
-- Data for Name: custom_searches; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.custom_searches (id, id_user, title, language, timeframe, keyword) OVERRIDING SYSTEM VALUE VALUES (7, 4, 'second template', 'en', 'Weekly', 'Surf, Bateau, Mer');
INSERT INTO public.custom_searches (id, id_user, title, language, timeframe, keyword) OVERRIDING SYSTEM VALUE VALUES (1, 4, 'first temp', 'en', 'Monthly', 'Intelligence artificielle, Programmation');


--
-- TOC entry 5055 (class 0 OID 16931)
-- Dependencies: 227
-- Data for Name: custom_searches_has_categories; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.custom_searches_has_categories (id, id_custom_search, id_category) OVERRIDING SYSTEM VALUE VALUES (5, 7, 3);
INSERT INTO public.custom_searches_has_categories (id, id_custom_search, id_category) OVERRIDING SYSTEM VALUE VALUES (6, 7, 2);
INSERT INTO public.custom_searches_has_categories (id, id_custom_search, id_category) OVERRIDING SYSTEM VALUE VALUES (7, 1, 2);
INSERT INTO public.custom_searches_has_categories (id, id_custom_search, id_category) OVERRIDING SYSTEM VALUE VALUES (8, 1, 1);


--
-- TOC entry 5052 (class 0 OID 16520)
-- Dependencies: 224
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.roles (id, role) OVERRIDING SYSTEM VALUE VALUES (1, 'Admin');
INSERT INTO public.roles (id, role) OVERRIDING SYSTEM VALUE VALUES (2, 'User');


--
-- TOC entry 5062 (class 0 OID 0)
-- Dependencies: 222
-- Name: categories_list_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.categories_list_id_seq', 5, true);


--
-- TOC entry 5063 (class 0 OID 0)
-- Dependencies: 228
-- Name: custom-searches_has_categories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."custom-searches_has_categories_id_seq"', 8, true);


--
-- TOC entry 5064 (class 0 OID 0)
-- Dependencies: 225
-- Name: history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.history_id_seq', 7, true);


--
-- TOC entry 5065 (class 0 OID 0)
-- Dependencies: 223
-- Name: roles_list_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.roles_list_id_seq', 2, true);


--
-- TOC entry 5066 (class 0 OID 0)
-- Dependencies: 221
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_id_seq', 6, true);


--
-- TOC entry 4881 (class 2606 OID 16417)
-- Name: categories categories_list_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_list_pkey PRIMARY KEY (id);


--
-- TOC entry 4893 (class 2606 OID 16972)
-- Name: custom_searches_has_categories custom_searches_has_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_searches_has_categories
    ADD CONSTRAINT custom_searches_has_categories_pkey PRIMARY KEY (id);


--
-- TOC entry 4889 (class 2606 OID 16853)
-- Name: custom_searches custom_searches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_searches
    ADD CONSTRAINT custom_searches_pkey PRIMARY KEY (id);


--
-- TOC entry 4885 (class 2606 OID 16527)
-- Name: roles roles_list_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_list_pkey PRIMARY KEY (id);


--
-- TOC entry 4883 (class 2606 OID 16691)
-- Name: categories u_categories_list; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT u_categories_list UNIQUE (category_name);


--
-- TOC entry 4891 (class 2606 OID 16990)
-- Name: custom_searches u_custom_searches; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_searches
    ADD CONSTRAINT u_custom_searches UNIQUE (id_user, title);


--
-- TOC entry 4895 (class 2606 OID 16940)
-- Name: custom_searches_has_categories u_custom_searches_has_categories; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_searches_has_categories
    ADD CONSTRAINT u_custom_searches_has_categories UNIQUE (id_custom_search, id_category);


--
-- TOC entry 4887 (class 2606 OID 16689)
-- Name: roles u_roles_list; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT u_roles_list UNIQUE (role);


--
-- TOC entry 4877 (class 2606 OID 16666)
-- Name: users u_users; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT u_users UNIQUE (username) INCLUDE (email);


--
-- TOC entry 4879 (class 2606 OID 16396)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- TOC entry 4898 (class 2606 OID 16946)
-- Name: custom_searches_has_categories fk_category; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_searches_has_categories
    ADD CONSTRAINT fk_category FOREIGN KEY (id_category) REFERENCES public.categories(id);


--
-- TOC entry 4899 (class 2606 OID 16941)
-- Name: custom_searches_has_categories fk_custom_search; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_searches_has_categories
    ADD CONSTRAINT fk_custom_search FOREIGN KEY (id_custom_search) REFERENCES public.custom_searches(id);


--
-- TOC entry 4896 (class 2606 OID 16528)
-- Name: users fk_id_role; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_id_role FOREIGN KEY (role) REFERENCES public.roles(id) NOT VALID;


--
-- TOC entry 4897 (class 2606 OID 16991)
-- Name: custom_searches fk_id_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_searches
    ADD CONSTRAINT fk_id_user FOREIGN KEY (id_user) REFERENCES public.users(id) NOT VALID;


-- Completed on 2026-05-11 09:23:45

--
-- PostgreSQL database dump complete
--

