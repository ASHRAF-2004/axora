import { integrationOrigin } from "./config";
import { INTEGRATION_SCOPES } from "./scopes";

export const EXTERNAL_API_ROUTE_CONTRACT = [
  { method:"get",path:"/api/v1/me",scope:null,operationId:"getCurrentPrincipal" },
  { method:"get",path:"/api/v1/companies",scope:"companies:read",operationId:"listCompanies" },
  { method:"get",path:"/api/v1/companies/{id}",scope:"companies:read",operationId:"getCompany" },
  { method:"get",path:"/api/v1/requests",scope:"requests:read",operationId:"listRequests" },
  { method:"get",path:"/api/v1/requests/{id}",scope:"requests:read",operationId:"getRequest" },
  { method:"get",path:"/api/v1/deliveries",scope:"deliveries:read",operationId:"listDeliveries" },
  { method:"get",path:"/api/v1/deliveries/{id}",scope:"deliveries:read",operationId:"getDelivery" },
  { method:"get",path:"/api/v1/invoices",scope:"invoices:read",operationId:"listInvoices" },
  { method:"get",path:"/api/v1/invoices/{id}",scope:"invoices:read",operationId:"getInvoice" },
  { method:"post",path:"/api/v1/request-drafts",scope:"requests:draft",operationId:"createRequestDraft" },
] as const;

const errorResponse = {
  description:"A security-safe API error. Internal exceptions and database details are never returned.",
  content:{"application/json":{schema:{$ref:"#/components/schemas/ErrorEnvelope"}}},
};

const rateHeaders = {
  "RateLimit-Limit":{schema:{type:"integer"},description:"Tightest request limit for the current 60-second window."},
  "RateLimit-Remaining":{schema:{type:"integer"},description:"Requests remaining in the tightest active bucket."},
  "RateLimit-Reset":{schema:{type:"integer"},description:"Seconds until the current bucket resets."},
};

const commonResponses = {
  "400":errorResponse,"401":errorResponse,"403":errorResponse,"404":errorResponse,
  "429":{...errorResponse,headers:{...rateHeaders,"Retry-After":{schema:{type:"integer"}}}},
  "503":errorResponse,
};

const paginationParameters = [
  { name:"limit",in:"query",required:false,schema:{type:"integer",minimum:1,maximum:100,default:25},description:"Maximum records returned." },
  { name:"cursor",in:"query",required:false,schema:{type:"string",maxLength:2048},description:"Opaque, route- and company-bound continuation cursor." },
];

const idParameter = [{
  name:"id",in:"path",required:true,schema:{type:"string",format:"uuid"},
  description:"Resource UUID. Missing and unauthorized resources use the same not-found response.",
}];

function success(schema: Record<string,unknown>,description="Successful response.") {
  return {
    description,
    headers:{...rateHeaders,"Axora-Request-Id":{schema:{type:"string",format:"uuid"}}},
    content:{"application/json":{schema:{
      type:"object",required:["data","meta"],properties:{
        data:schema,meta:{$ref:"#/components/schemas/ResponseMeta"},
      },
    }}},
  };
}

function listOperation(input: {
  operationId:string;summary:string;scope:string;schema:string;
}) {
  return {
    operationId:input.operationId,summary:input.summary,
    security:[{oauth2:[input.scope]}],parameters:paginationParameters,
    responses:{"200":success({type:"array",items:{$ref:`#/components/schemas/${input.schema}`}}),...commonResponses},
  };
}

function readOperation(input: {
  operationId:string;summary:string;scope:string;schema:string;
}) {
  return {
    operationId:input.operationId,summary:input.summary,
    security:[{oauth2:[input.scope]}],parameters:idParameter,
    responses:{"200":success({$ref:`#/components/schemas/${input.schema}`}),...commonResponses},
  };
}

export function buildAxoraOpenApiDocument() {
  const origin = integrationOrigin();
  return {
    openapi:"3.1.0",
    info:{
      title:"Axora External API",version:"1.0.0",
      description:"A conservative, tenant-scoped procurement API. OAuth scopes only restrict access further: every request also re-evaluates the delegating user's live Axora role, assignment, company/branch scope, explicit DENY rules, connection, and resource policy. External writes cannot approve, spend, pay, finalize, or deliver.",
    },
    servers:[{url:origin,description:"Canonical Axora HTTPS origin"}],
    tags:[
      {name:"Identity",description:"Current delegated principal and live connection context."},
      {name:"Companies",description:"Safe profile of the connected company only."},
      {name:"Requests",description:"Authorized request reads and review-required staging drafts."},
      {name:"Deliveries",description:"Safe status only; no coordinates, proof paths, or private receiver data."},
      {name:"Invoices",description:"Customer invoices only; supplier cost and margin are excluded."},
      {name:"Webhooks",description:"Outbound signed webhooks are introduced by the independently gated webhook capability."},
    ],
    paths:{
      "/api/v1/openapi.json":{get:{operationId:"getOpenApiDocument",summary:"Get this OpenAPI contract",responses:{"200":{description:"OpenAPI 3.1 document."}}}},
      "/api/v1/me":{get:{
        tags:["Identity"],operationId:"getCurrentPrincipal",summary:"Get the live delegated principal",
        security:[{oauth2:[]}],responses:{"200":success({$ref:"#/components/schemas/Principal"}),...commonResponses},
      }},
      "/api/v1/companies":{get:{tags:["Companies"],...listOperation({operationId:"listCompanies",summary:"List the connected company",scope:"companies:read",schema:"Company"})}},
      "/api/v1/companies/{id}":{get:{tags:["Companies"],...readOperation({operationId:"getCompany",summary:"Get the connected company",scope:"companies:read",schema:"Company"})}},
      "/api/v1/requests":{get:{tags:["Requests"],...listOperation({operationId:"listRequests",summary:"List authorized requests",scope:"requests:read",schema:"Request"})}},
      "/api/v1/requests/{id}":{get:{tags:["Requests"],...readOperation({operationId:"getRequest",summary:"Get an authorized request",scope:"requests:read",schema:"Request"})}},
      "/api/v1/deliveries":{get:{tags:["Deliveries"],...listOperation({operationId:"listDeliveries",summary:"List authorized delivery statuses",scope:"deliveries:read",schema:"Delivery"})}},
      "/api/v1/deliveries/{id}":{get:{tags:["Deliveries"],...readOperation({operationId:"getDelivery",summary:"Get an authorized delivery status",scope:"deliveries:read",schema:"Delivery"})}},
      "/api/v1/invoices":{get:{tags:["Invoices"],...listOperation({operationId:"listInvoices",summary:"List authorized customer invoices",scope:"invoices:read",schema:"Invoice"})}},
      "/api/v1/invoices/{id}":{get:{tags:["Invoices"],...readOperation({operationId:"getInvoice",summary:"Get an authorized customer invoice",scope:"invoices:read",schema:"Invoice"})}},
      "/api/v1/request-drafts":{post:{
        tags:["Requests"],operationId:"createRequestDraft",summary:"Create a review-required request draft",
        description:"Creates isolated staging data only. It does not submit or approve a request, reserve/spend budget, debit a Wallet, create a payment/invoice, or create a delivery. An authorized Axora requester must import into an empty cart, review current pricing and budget, and submit through Axora. Company Administrator direct purchase is never used for this action.",
        security:[{oauth2:["requests:draft"]}],
        parameters:[{name:"Idempotency-Key",in:"header",required:true,schema:{type:"string",minLength:8,maxLength:128,pattern:"^[A-Za-z0-9._~:-]+$"},description:"Retry key scoped to the authenticated company connection and command, including across grant rotation. Reuse with a different payload returns conflict."}],
        requestBody:{required:true,content:{"application/json":{schema:{$ref:"#/components/schemas/RequestDraftInput"}}}},
        responses:{"201":success({$ref:"#/components/schemas/RequestDraft"},"Draft created or safely replayed."),"409":errorResponse,...commonResponses},
      }},
    },
    components:{
      securitySchemes:{oauth2:{
        type:"oauth2",description:"OAuth 2.1-style Authorization Code with mandatory PKCE S256. Opaque access tokens are short-lived; refresh tokens rotate and family reuse revokes the grant.",
        flows:{authorizationCode:{authorizationUrl:`${origin}/oauth/authorize`,tokenUrl:`${origin}/oauth/token`,refreshUrl:`${origin}/oauth/token`,scopes:Object.fromEntries(INTEGRATION_SCOPES.map((scope)=>[scope,scope]))}},
      }},
      schemas:{
        ResponseMeta:{type:"object",required:["request_id"],properties:{request_id:{type:"string",format:"uuid"},pagination:{$ref:"#/components/schemas/Pagination"},idempotency_replayed:{type:"boolean"}}},
        Pagination:{type:"object",required:["limit","has_more","next_cursor"],properties:{limit:{type:"integer"},has_more:{type:"boolean"},next_cursor:{type:["string","null"]}}},
        ErrorEnvelope:{type:"object",required:["error"],properties:{error:{type:"object",required:["code","message","request_id"],properties:{code:{type:"string",enum:["feature_disabled","unauthorized","invalid_token","insufficient_scope","forbidden","not_found","invalid_request","conflict","rate_limited","temporarily_unavailable","internal_error"]},message:{type:"string"},request_id:{type:"string",format:"uuid"},field:{type:"string"}}}}},
        Principal:{type:"object",description:"Delegating user's current identity, connection, scopes, and access-token expiry. Email is returned only to that same authenticated delegated principal.",additionalProperties:true},
        Company:{type:"object",required:["id","name","status","resource_url"],properties:{id:{type:"string",format:"uuid"},name:{type:"string"},status:{type:"string"},resource_url:{type:"string"}},additionalProperties:true},
        Request:{type:"object",description:"Customer-safe request. Supplier acquisition cost, buying cost, and margin are never present.",required:["id","company_id","branch_id","resource_url"],properties:{id:{type:"string",format:"uuid"},company_id:{type:"string",format:"uuid"},branch_id:{type:"string",format:"uuid"},resource_url:{type:"string"}},additionalProperties:true},
        Delivery:{type:"object",description:"Safe status without raw GPS history, proof paths, telemetry, or private receiver details.",required:["id","company_id","status","resource_url"],properties:{id:{type:"string",format:"uuid"},company_id:{type:"string",format:"uuid"},status:{type:"string"},resource_url:{type:"string"}},additionalProperties:true},
        Invoice:{type:"object",description:"Customer-direction invoice only; supplier cost and margin are excluded.",required:["id","company_id","invoice_number","resource_url"],properties:{id:{type:"string",format:"uuid"},company_id:{type:"string",format:"uuid"},invoice_number:{type:"string"},resource_url:{type:"string"}},additionalProperties:true},
        RequestDraftInput:{type:"object",additionalProperties:false,required:["branch_id","needed_by_date","urgency","items"],properties:{branch_id:{type:"string",format:"uuid"},request_type:{type:"string",const:"Standard",default:"Standard"},department:{type:"string",minLength:2,maxLength:160,description:"Non-authoritative external reference shown during review. Axora resolves the real department from the reviewing user's live scope."},needed_by_date:{type:"string",format:"date"},urgency:{type:"string",enum:["Low","Normal","High","Urgent"]},notes:{type:"string",maxLength:2000},items:{type:"array",minItems:1,maxItems:100,items:{type:"object",additionalProperties:false,required:["product_reference","quantity"],properties:{product_reference:{type:"string",pattern:"^item-[a-f0-9]{20}$"},quantity:{type:"integer",minimum:1,maximum:1000000},specification:{type:"string",maxLength:1000}}}}}},
        RequestDraft:{type:"object",required:["id","draft_code","status","review_url"],properties:{id:{type:"string",format:"uuid"},draft_code:{type:"string"},status:{type:"string",const:"pending_review"},review_url:{type:"string"}},additionalProperties:true},
      },
    },
    externalDocs:{description:"Axora integration security and operational documentation",url:`${origin}/api/v1/openapi.json`},
  };
}
