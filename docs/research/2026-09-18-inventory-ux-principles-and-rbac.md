# Inventory UX principles: the till surface vs the back-office surface, and RBAC

- Date: 2026-09-18 (local, America/Mazatlan).
- Question: how does a multi-screen inventory product split its work between a fast
  transactional surface (a till) and a slow administrative surface (a back office)? How does
  role-based access control (RBAC) interact with that split?
- Scope: UX architecture only. This report does not compare inventory features. It does not
  repeat [2026-09-05-pos-navigation-and-cashier-vs-manager-ia.md](2026-09-05-pos-navigation-and-cashier-vs-manager-ia.md),
  which owns the NN/g progressive-disclosure rule, the Apple and Material action-bar counts,
  and the four POS vendors' hardware split. This report cites that file and answers the
  inventory-specific questions that it does not cover.
- Labels: **Documented fact** (a source owns it, with the URL), **Source-backed tradeoff**
  (two sources disagree, or a source states a cost), **Inference** (reasoned from the facts),
  or **UNVERIFIED**.

## 0. Step 0 of the task, and the routes used

| Question                              | Answer                                                                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does a proven tool already do this?   | Yes. The work is source retrieval, not measurement. The tool is `curl` with a text extractor, plus each vendor's public help-centre API.                              |
| Is it installed here?                 | Yes. `curl` 8.5.0, `python3` 3.12.3, `jq` 1.7, `pdftotext` (poppler), `node` v22.23.2.                                                                                |
| Can an agent drive it with no prompt? | Yes. All calls are non-interactive.                                                                                                                                   |
| What does adoption cost?              | None. No install. No account.                                                                                                                                         |
| What is the fallback?                 | `r.jina.ai` for a JavaScript page, the vendor's help-centre JSON API for a Zendesk site, and the vendor's own search API for Microsoft Learn and the SAP Help Portal. |

Routes that worked on 2026-09-18:

| Route                                                        | Method                                                 | Result                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `developer.apple.com`                                        | `r.jina.ai` in front of the HIG page                   | **Worked.** The raw page returns a JavaScript shell. The proxy returned the full Settings page.                              |
| `m3.material.io`                                             | `r.jina.ai`                                            | **Worked.** The raw page returns a shell. The proxy returned breakpoints, navigation drawer, and canonical-layout text.      |
| `learn.microsoft.com`                                        | plain `curl`                                           | **Worked.** Full article text.                                                                                               |
| `www.nngroup.com`                                            | plain `curl`                                           | **Worked.** Full article text.                                                                                               |
| `odoo.com/documentation`                                     | plain `curl` + `<main>` extraction                     | **Worked.**                                                                                                                  |
| `help.marginedge.com`                                        | Zendesk API `/api/v2/help_center/articles/search.json` | **Worked, and it is the best route found for this product class.** 44 articles for "waste mobile app".                       |
| `doc.toasttab.com`                                           | plain `curl`                                           | **Worked.** Full permission reference.                                                                                       |
| `help.shopify.com`                                           | `r.jina.ai`                                            | **Worked.** The raw page returns a Cloudflare JavaScript challenge. The proxy returned the permission tables.                |
| `docs.aws.amazon.com`                                        | plain `curl` + the `.md` variant                       | **Worked.** The HTML omits the body of most sections. The markdown variant (`best-practices.md`) holds the full text.        |
| `help.sap.com`                                               | the portal search API `/http.svc/elasticsearch`        | **Worked for the index.** The topic HTML is a JavaScript shell.                                                              |
| `www.zoho.com/inventory/` and `www.zoho.com/inventory/help/` | plain `curl`, then `r.jina.ai`                         | **Blocked.** 403 both ways.                                                                                                  |
| `web.archive.org`                                            | CDX and replay                                         | **Blocked on 2026-09-18.** The service returned `AbuseAlleviationError: Anonymous access to domain web.archive.org blocked`. |

## 1. What the platform guidelines say about the fast surface and the administrative surface

The four guidelines agree on one rule. A configuration task belongs on a separate surface when
the user changes it rarely. A task that belongs to the main workflow stays on the main surface.

### 1.1 Apple Human Interface Guidelines, "Settings"

Apple states the split rule and the reason for it. **Documented fact**,
<https://developer.apple.com/design/human-interface-guidelines/settings>.

> "When necessary, you can provide a custom settings area within your app or game to offer
> general settings that affect your overall experience, like interface style or game-saving
> behavior. If you need to offer settings that affect only a specific task, you can provide
> these options within the task itself, so people don't have to leave the experience to
> customize it."

> "Put general, infrequently changed settings in your custom settings area. People must suspend
> what they're doing to open an app's or game's settings area, so you want to include options
> that people don't need to change all the time."

> "Minimize the number of settings you offer. Although people appreciate having control over an
> app or game, too many settings can make the experience feel less approachable, while also
> making it hard to find a particular setting."

Apple also requires good defaults. "Aim to provide default settings that give the best
experience to the largest number of people." **Documented fact**, same URL.

### 1.2 Microsoft Windows design guidelines, "Guidelines for app settings"

Microsoft states the same rule with a sharper test for what stays out. **Documented fact**,
<https://learn.microsoft.com/en-us/windows/apps/design/app-settings/guidelines-for-app-settings>.

> "App settings are the user-customizable portions of your Windows app, accessed through a
> dedicated settings page."

> "Commands that are part of the typical app workflow (for example, changing the brush size in
> an art app) shouldn't be in a settings page."

> "Don't include commands that are part of the common app workflow."

Microsoft names the settings that belong on the page. "Configuration options that affect the
behavior of the app and don't require frequent readjustment". Microsoft also fixes the entry
point. In a `NavigationView` layout the settings entry "should be the last item in the list of
navigational choices and be pinned to the bottom". **Documented fact**, same URL.

### 1.3 Material Design 3, canonical layouts and navigation

Material 3 gives the layout recipe for a second surface on a large screen.
**Documented fact**, <https://m3.material.io/foundations/layout/canonical-layouts/supporting-pane>.

> "The supporting pane layout organizes content into primary and secondary areas."

> "Use the supporting pane layout when the secondary content is only meaningful in relation to
> the primary content."

The list-detail canonical layout names settings as a use case: "Settings + category detail".
The pane count follows the breakpoint. **Documented fact**,
<https://m3.material.io/foundations/layout/canonical-layouts/list-detail>,
<https://m3.material.io/foundations/layout/applying-layout/window-size-classes>.

> "Layouts typically transition from a single pane to two or three panes as window size
> increases."

The navigation component follows the breakpoint too. Material uses a navigation bar on a
compact window, a navigation rail on a medium or expanded window, and a standard navigation
drawer on a large or extra-large window. Material reserves the drawer for a wide hierarchy:
"Use a navigation drawer for 5 or more primary destinations, or more than 1 level of navigation
hierarchy". **Documented fact**, <https://m3.material.io/components/navigation-drawer/guidelines>.

**Inference for Umi.** Material states the mechanism for the surface split. A back office with
many destinations and two levels of hierarchy belongs in a drawer on a desktop-class window. A
cashier surface does not.

### 1.4 Nielsen Norman Group, complex applications

NN/g defines the class of product that needs this split. A complex application supports "the
broad, unstructured goals or nonlinear workflows of highly trained users in specialized
domains". **Documented fact**, <https://www.nngroup.com/articles/complex-application-design/>.

NN/g then names the rules that matter for an inventory product:

> "Coordinate Transition Among Multiple Tools and Workspaces" - "Reduce the burden of tool
> switching by supporting the transition from one environment to another, both inside and
> outside the primary application."

> "Ease Transition Between Primary and Secondary Information" - "Some information must be
> deferred to secondary levels; however, that secondary information is often necessary to
> contextualize and make decisions about information on the primary level."

**Documented fact**, same URL.

**Source-backed tradeoff.** Apple, Microsoft, and Material agree that the rare setup task
leaves the main surface. NN/g adds a cost on the other side. A hidden surface still needs a
good bridge, because the operator must move between the two surfaces to make a decision. The
same NN/g article lists "Reduce Clutter Without Reducing Capability" as guideline 6. **Documented
fact**, same URL.

### 1.5 What this section does NOT claim

The number of trailing action icons in a top app bar, the tab-bar count, and the POS hardware
split are already sourced in
[2026-09-05-pos-navigation-and-cashier-vs-manager-ia.md](2026-09-05-pos-navigation-and-cashier-vs-manager-ia.md).
That file owns those rules. This report does not restate them.

## 2. What the inventory and ERP vendors document about the back office and the POS split

### 2.1 Odoo 18.0

Odoo ships Inventory and Point of Sale as two separate apps. Each app page states what it owns.
**Documented fact**, <https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory.html>,
<https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale.html>.

Inventory app:

> "Odoo Inventory is both an inventory application and a warehouse management system. The app
> allows users to easily manage lead times, automate replenishment, configure advanced routes,
> and more."

Point of Sale app:

> "With Odoo Point of Sale, run your shops and restaurants easily. The app works on any device
> with a web browser, even if you are temporarily offline. Product moves are automatically
> registered in your stock, you get real-time statistics, and your data is consolidated across
> all shops."

Odoo states the boundary in the POS page. The POS registers the product move. The Inventory app
holds the warehouse model. Odoo also states that a configuration task lives in the backend.
The POS page tells the reader to create and manage customers "from the backend", with the path
Point of Sale > Orders > Customers. **Documented fact**, same URLs.

The Inventory app's own table of contents names the administrative operations: "Inventory
adjustments", "Cycle counts", "Scrap inventory", "Physical inventory", "Reordering rules", and
"Reporting". **Documented fact**, same URL.

### 2.2 SAP Business One

SAP documents "Inventory and Logistics" as a module area of SAP Business One. The module holds
"Inventory Transactions", "Inventory Revaluation Wizard", and "Inventory Status Dashboard".
**Documented fact** (SAP Help Portal search index), <https://help.sap.com/docs/SAP_BUSINESS_ONE>.

A separate help set for the SAP Business One Web Client names an "Inventory Settings" page and
an "Inventory Status Dashboard". **Documented fact**, SAP Help Portal index, same host.

A search for "point of sale" against the SAP Business One help index returns no SAP Business One
topic. **Documented fact** (a negative result): the query returned no page whose URL holds
`SAP_BUSINESS_ONE`. The conclusion that SAP Business One has no first-party POS surface is
**UNVERIFIED**. SAP commonly delivers retail POS for Business One through partners and add-ons.
This report does not assert a partner product.

### 2.3 Microsoft Dynamics 365

Microsoft documents the split as two products. Business Central is the ERP. The transactional
POS is Dynamics 365 Commerce.

Business Central, Inventory:

> "For each physical product, you must create an item card of the Inventory type."

> "The physical handling of items is referred to as warehouse activities."

**Documented fact**,
<https://learn.microsoft.com/en-us/dynamics365/business-central/inventory-manage-inventory>.

Dynamics 365 Commerce, POS:

> "Most actions that users take in the point of sale (POS) are operations. You configure and
> manage operations in the Dynamics 365 Commerce back office."

**Documented fact**,
<https://learn.microsoft.com/en-us/dynamics365/commerce/pos-operations>.

The POS setup path is also documented. The reader marks an operation on the
"POS operations view in Commerce headquarters (Retail and Commerce - Channel Setup - POS setup -
POS - POS Operations)". **Documented fact**, same URL.

**Inference.** Microsoft's strongest statement is structural. The company puts the till in one
product and the ERP in another. Microsoft does not document a Business Central POS page; a
search of Microsoft Learn for a Business Central POS returns Commerce pages only.

### 2.4 Zoho

Zoho Inventory's product site and help site returned **403** to this workstation by two routes.
Zoho publishes Zoho POS as a separate product page. **Documented fact**,
<https://www.zoho.com/pos/>.

The exact Zoho statement of what Zoho Inventory owns against Zoho POS and Zoho Books is
**UNVERIFIED**. The block is an access failure on this machine, not an absent page.

### 2.5 The vendor table

| Vendor           | Back-office surface                     | Till surface                | The boundary statement                                                          | URL                                                                                       |
| ---------------- | --------------------------------------- | --------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Odoo 18.0        | Inventory (warehouse management system) | Point of Sale               | "Product moves are automatically registered in your stock."                     | [Odoo POS](https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale.html) |
| SAP Business One | Inventory and Logistics                 | None documented first-party | No SAP Business One topic for "point of sale" in the help index                 | [SAP Help](https://help.sap.com/docs/SAP_BUSINESS_ONE)                                    |
| Dynamics 365     | Business Central (Inventory)            | Commerce (POS)              | "You configure and manage operations in the Dynamics 365 Commerce back office." | [Commerce POS](https://learn.microsoft.com/en-us/dynamics365/commerce/pos-operations)     |
| Zoho             | Zoho Inventory                          | Zoho POS                    | UNVERIFIED (403)                                                                | [Zoho POS](https://www.zoho.com/pos/)                                                     |

## 3. Permission granularity: the exact permission names in this product class

### 3.1 Shopify

Shopify names an inventory permission and states what it allows. **Documented fact**,
<https://help.shopify.com/en/manual/your-account/users/roles/permissions/store-permissions>.

| Permission                                 | The exact sentence                                                                                                                            | URL               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **Manage inventory (excluding transfers)** | "This permission allows users to create, track, import, and export inventory. Allows users to edit inventory quantities, SKUs, and barcodes." | store-permissions |
| **View transfers**                         | "This permission allows users to view inventory transfers."                                                                                   | store-permissions |
| **Manage transfers**                       | "This permission allows users to create and update inventory transfers."                                                                      | store-permissions |
| **Manage shipments**                       | "This permission allows users to create, track, and update shipments for inventory transfers."                                                | store-permissions |

Shopify then states the dependency. "All inventory permissions also require the **View
products** permission." **Documented fact**, same URL.

**The strong finding is the surface split.** Shopify puts all four inventory permissions in the
**Store** permission category. The POS permission list for a POS role holds these groups only:
Checkout, Discounts, Orders, Customers, Apps, Analytics, Register, and Store settings.
**Documented fact**,
<https://help.shopify.com/en/manual/your-account/users/roles/permissions/pos-permissions>.

> "POS permissions grant access to different areas of Shopify POS and the Point of Sale channel
> to manage POS-level tasks."

**Inference.** Shopify does not offer an inventory permission on the till. The Shopify model
tells a cashier to view inventory, but it does not give the cashier an inventory write on the
POS role. **Documented fact** for the view rule: "Regardless of their assigned location, staff
members can view product inventory for all locations within the POS app."

### 3.2 Toast

Toast names an inventory permission and states what it allows. **Documented fact**,
<https://doc.toasttab.com/doc/platformguide/adminPermissions.html>.

> **Inventory & Quantity** - "Gives access to quick edit mode on the Toast POS app where the
> employee can mark a menu item or modifier option as In Stock or Out of Stock, or adjust the
> quantity on hand. Assign to managers and employees who need to make inventory adjustments
> directly on a Toast POS device."

Toast states the use case and the limit in the same page:

> "For example, you can give an employee the Inventory & Quantity permission to allow them to
> mark a menu item as out of stock, but not give the employee any other quick edit permissions
> for tasks such as editing prices or re-arranging menu items in their menu groups."

> "The quick edit feature is not well suited to customers who use the enterprise module because,
> as a general rule, you must be an owner of a menu entity in order to edit it. However, the
> Inventory & Quantity permission can and should be used by enterprise customers."

Toast separates the two surfaces by permission section. **Documented fact**, same URL.

> "POS access permissions: The POS access permissions give employees the ability to use the main
> modes, or functions, of the Toast POS device."

> "Permissions in the Web Setup section control access to configuration options in Toast Web."

Toast also states the assignment unit. **Documented fact**, same URL.

> "Typically, you do not assign access permissions to individual employees. Instead, you group a
> set of access permissions into a job, and then assign the job to the employees who need to use
> the corresponding feature set."

### 3.3 Square

Square documents permission levels, not one inventory permission name. **Documented fact**,
<https://squareup.com/help/us/en/article/5822-employee-permissions>.

> "Select a permission level: Standard, Enhanced, Full."

> "Toggle on Full access to allow all permissions except managing bank accounts."

Square documents one model for both surfaces. **Documented fact**, same URL.

> "Permissions define what your team members can see or do within your Square Point of Sale,
> the Square Team app, Square Dashboard, and the Square Dashboard app."

Square Advanced Access repeats the same scope. **Documented fact**,
<https://squareup.com/us/en/staff/advanced-access>.

> "Easily create multiple levels of access across all Square products with unlimited custom
> permission sets so you can delegate responsibilities and control what your team can see and
> do, such as issue refunds or edit orders."

The exact Square permission label for an inventory action is **UNVERIFIED**. The support page
names the levels and the scope, not the label of the inventory toggle.

### 3.4 The permission router table

| Vendor  | Permission name (exact)                          | What it allows (exact)                                                                                                                                                         | Surface       | Model                           |
| ------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------------------------------- |
| Shopify | **Manage inventory (excluding transfers)**       | "This permission allows users to create, track, import, and export inventory. Allows users to edit inventory quantities, SKUs, and barcodes."                                  | Store (admin) | Two sets: Store and POS         |
| Shopify | **Manage transfers** / **Manage shipments**      | "This permission allows users to create and update inventory transfers."                                                                                                       | Store (admin) | Two sets                        |
| Toast   | **Inventory & Quantity**                         | "Gives access to quick edit mode on the Toast POS app where the employee can mark a menu item or modifier option as In Stock or Out of Stock, or adjust the quantity on hand." | POS           | Two sections: POS and Web Setup |
| Square  | Level name: **Standard**, **Enhanced**, **Full** | "Permissions define what your team members can see or do within your Square Point of Sale, the Square Team app, Square Dashboard, and the Square Dashboard app."               | Both          | One model                       |

## 4. Why one role model strains: permission sprawl, least privilege, and two surfaces

### 4.1 NIST RBAC (ANSI/INCITS 359)

NIST states the problem that RBAC solves and the standard number. **Documented fact**,
<https://csrc.nist.gov/projects/role-based-access-control>.

> "One of the most challenging problems in managing large networks is the complexity of security
> administration."

> "Role based access control (RBAC) (also called 'role based security'), as formalized in 1992 by
> David Ferraiolo and Rick Kuhn, has become the predominant model for advanced access control
> because it reduces this cost."

> "The NIST model for RBAC was adopted as American National Standard 359-2004 by the American
> National Standards Institute, International Committee for Information Technology Standards
> (ANSI/INCITS) on February 11, 2004. It was revised as INCITS 359-2012 in 2012."

**Documented fact.** The NIST page also marks the project as archived: "ARCHIVED PROJECT: This
project is no longer being supported." The full standard text is not free on this page. The
Static Separation of Duty (SSD) and Dynamic Separation of Duty (DSD) descriptions live in the
paid standard. Those exact clauses are **UNVERIFIED** here.

### 4.2 NIST SP 800-162, "Guide to Attribute Based Access Control (ABAC)"

The NIST ABAC definition. **Documented fact**, NIST SP 800-162, page 6,
DOI <https://doi.org/10.6028/NIST.SP.800-162>,
<https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-162.pdf>.

> "Attribute Based Access Control (ABAC): An access control method where subject requests to
> perform operations on objects are granted or denied based on assigned attributes of the
> subject, assigned attributes of the object, environment conditions, and a set of policies that
> are specified in terms of those attributes and conditions."

NIST names the failure mode of a static role model. **Documented fact**, NIST SP 800-162.

> "Trying to implement these kinds of access control decisions would require the creation of
> numerous roles that are ad hoc and limited in membership, leading to what is often termed
> 'role explosion'."

NIST names the drift risk. **Documented fact**, NIST SP 800-162.

> "Failure to remove or revoke access over time leads to users accumulating privileges."

NIST also states the RBAC definition that a back office uses today. **Documented fact**, NIST SP
800-162, section on RBAC.

> "Role-Based Access Control model (RBAC) ... employs pre-defined roles that carry a specific set
> of privileges associated with them and to which subjects are assigned."

### 4.3 OWASP Authorization Cheat Sheet

OWASP takes a position against one role model for a complex product. **Documented fact**,
<https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html>.

The section heading is itself the rule: "Prefer Attribute and Relationship Based Access Control
over RBAC".

> "The decision between the models has significant implications for the entire SDLC and should
> be made as early as possible."

OWASP states the deny-by-default rule and the justification rule. **Documented fact**, same URL.

> "For security purposes an application should be configured to deny access by default."

> "One should be able to explicitly justify why a specific permission was granted to a
> particular user or group rather than assuming access to be the default position."

### 4.4 Google Zanzibar

The Zanzibar paper is the primary source for a relationship-based model at scale. **Documented
fact**, USENIX ATC 2019, <https://www.usenix.org/conference/atc19/presentation/pang>.

> "Determining whether online users are authorized to access digital objects is central to
> preserving privacy. This paper presents the design, implementation, and deployment of
> Zanzibar, a global system for storing and evaluating access control lists."

> "Zanzibar provides a uniform data model and configuration language for expressing a wide range
> of access control policies from hundreds of client services at Google, including Calendar,
> Cloud, Drive, Maps, Photos, and YouTube."

> "Zanzibar scales to trillions of access control lists and millions of authorization requests
> per second to support services used by billions of people."

### 4.5 AWS IAM best practices

AWS states the least-privilege rule and the maturation path. **Documented fact**,
<https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html>.

> "When you set permissions with IAM policies, grant only the permissions required to perform a
> task. You do this by defining the actions that can be taken on specific resources under
> specific conditions, also known as least-privilege permissions."

> "You might start with broad permissions while you explore the permissions that are required for
> your workload or use case. As your use case matures, you can work to reduce the permissions
> that you grant to work toward least privilege."

### 4.6 Why the dashboard strains: the sources, then the inference

The sources state four facts, and no source states the Umi conclusion directly.

| Source          | Rule name        | Exact quote                                                                            | URL                                                                                    |
| --------------- | ---------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| NIST RBAC       | The RBAC purpose | "Role based access control (RBAC) ... reduces this cost."                              | [CSRC](https://csrc.nist.gov/projects/role-based-access-control)                       |
| NIST SP 800-162 | Role explosion   | "leading to what is often termed 'role explosion'."                                    | [PDF](https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-162.pdf)       |
| NIST SP 800-162 | Privilege drift  | "Failure to remove or revoke access over time leads to users accumulating privileges." | [PDF](https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-162.pdf)       |
| OWASP           | Model choice     | "Prefer Attribute and Relationship Based Access Control over RBAC."                    | [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) |
| OWASP           | Deny by default  | "an application should be configured to deny access by default."                       | [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) |
| AWS             | Least privilege  | "grant only the permissions required to perform a task."                               | [AWS](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)            |

**Inference, and it is the answer to question 4.** One dashboard role model must serve two
populations with opposite needs. The cashier population is large, changes often, and needs a
small permission set on one device. The owner population is small, changes rarely, and needs a
wide permission set on many devices. NIST names the result of a static model under this
pressure: role explosion. OWASP names the fix: a rule set that evaluates attributes and
relationships, not only a role name.

**Source-backed tradeoff.** Square shows the cost in a real product. One Square permission set
applies to "Square Point of Sale, the Square Team app, Square Dashboard, and the Square
Dashboard app" (documented above). That is simple to explain. It is also the model that forces
the owner to read a permission list built for both surfaces at once.

## 5. Multi-location and multi-device: the phone rule and the laptop rule

### 5.1 MarginEdge documents the phone rule

MarginEdge states that waste logging runs on both surfaces. **Documented fact**,
<https://help.marginedge.com/hc/en-us/articles/20415242210579-Waste-Log-Track-Your-Waste>.

> "Recording Waste: This is done on an item-by-item basis, as you can select either products or
> recipes. And it can be done through the web app or through your mobile app!"

> "Recording Waste on Your Phone - All the same procedures apply! You will have all the same
> fields to fill in for recording each product or recipe. To record waste in your mobile app,
> first go to the 'More' menu in the bottom right corner, and click on 'Waste Log'."

MarginEdge documents the count rule on the phone too. **Documented fact**,
<https://help.marginedge.com/hc/en-us/articles/47246904250515-Count-Sheet-Edits-on-the-Mobile-App>.

> "In the mobile app you can now modify your count sheet while taking an inventory"

> "This replicates the 'Config Mode' capability available on the web version of MarginEdge."

### 5.2 MarginEdge documents the divided-device rule

MarginEdge states the strongest multi-device rule in the set. **Documented fact**,
<https://help.marginedge.com/hc/en-us/articles/47207410379539-Setting-Up-a-Shared-Device-Tablet>.

> "Shared Device Mode allows you to set up a phone or tablet that your team can use to view
> recipes, upload invoices, take inventory, and record waste - all without accessing sensitive
> financial information."

> "Start in the web app - The first steps are completed from your computer."

> "What Team Members Can Do: View recipes (including videos, ingredients, and methods); Upload
> invoices; Take inventory; Record waste."

**Inference.** MarginEdge splits by device and by permission together. The phone or the tablet
carries the capture task. The computer carries the setup task. The shared device holds a PIN,
not an account, and it holds no financial data.

### 5.3 Shopify documents a mobile administrative surface

Shopify publishes a mobile app for the store owner. **Documented fact**,
<https://help.shopify.com/en/manual/shopify-mobile-app>.

> "With the Shopify app, you can manage your store from your iPhone or Android device."

> "From the Shopify app, you can see how your store is performing, manage your orders, and
> update your catalog."

### 5.4 Material states the pane rule for a small screen

Material states where a second pane goes on a small screen. **Documented fact**,
<https://m3.material.io/foundations/layout/canonical-layouts/supporting-pane>.

> "Compact: The supporting pane should appear below the focus pane. A bottom sheet can be useful
> for keeping focus on the primary pane while providing access to supporting information."

**Inference.** On a phone, the supporting pane becomes a sheet below the content. The
administrative surface does not become a second column on a phone.

## Rules we can adopt

1. **Put the rare configuration task on a separate surface.** Apple, Microsoft, and Material
   state this rule with the same test: the user changes a setting rarely, so the setting leaves
   the main surface. **Documented fact**, section 1.
2. **Keep the frequent task on the till surface.** Microsoft names the test. "Don't include
   commands that are part of the common app workflow" in a settings page. **Documented fact**,
   section 1.2.
3. **Give every surface its own navigation depth.** Material puts a drawer on a large window and
   a bar on a compact window. The drawer fits five or more destinations and two levels of
   hierarchy. **Documented fact**, section 1.3.
4. **Do not put the inventory write on the cashier role.** Shopify puts its four inventory
   permissions in the Store category, and the POS permission list holds no inventory group.
   **Documented fact**, section 3.1.
5. **Allow one small inventory action on the till, and name it.** Toast allows one action, the
   mark of an item as out of stock or the change of a quantity on hand, under one permission
   name. **Documented fact**, section 3.2.
6. **Assign a permission set to a job, not to a person.** Toast states this rule directly.
   **Documented fact**, section 3.2.
7. **Set the default to deny.** OWASP states this rule. Require a written reason for each
   permission. **Documented fact**, section 4.3.
8. **Plan the role model before the code.** OWASP states that the model decision "should be made
   as early as possible". **Documented fact**, section 4.3.
9. **Expect role growth from one model.** NIST names "role explosion" as the failure mode of a
   static role model under a dynamic rule set. **Documented fact**, section 4.2.
10. **Split the capture task by device.** MarginEdge runs inventory capture and waste logging on
    a phone or a shared tablet with a PIN, and it runs setup on a computer. **Documented fact**,
    section 5.2.
11. **Give the shared device no financial data.** MarginEdge states that rule for Shared Device
    Mode. **Documented fact**, section 5.2.
12. **Show the secondary surface as a sheet on a phone, not a second column.** Material states
    the compact-breakpoint rule. **Documented fact**, section 5.4.
13. **Use one word for one job.** Apple requires that the user suspend the main task to open
    settings. Microsoft requires that a workflow command stay out of the settings page. The two
    rules conflict for a task of medium frequency. **Source-backed tradeoff**, section 1.
14. **Define the Umi split explicitly, because no vendor publishes a full rule.** The four
    ERP vendors document their apps separately, but none publishes a "where does this task
    live" rule for inventory. **Inference**, section 2.5.

## Sources reached, and sources blocked

Reached:

- Apple HIG, Settings: <https://developer.apple.com/design/human-interface-guidelines/settings>
- Microsoft Windows, app settings: <https://learn.microsoft.com/en-us/windows/apps/design/app-settings/guidelines-for-app-settings>
- Material 3, breakpoints: <https://m3.material.io/foundations/layout/applying-layout/window-size-classes>
- Material 3, navigation drawer: <https://m3.material.io/components/navigation-drawer/guidelines>
- Material 3, supporting pane: <https://m3.material.io/foundations/layout/canonical-layouts/supporting-pane>
- Material 3, list-detail: <https://m3.material.io/foundations/layout/canonical-layouts/list-detail>
- NN/g, complex applications: <https://www.nngroup.com/articles/complex-application-design/>
- NN/g, progressive disclosure: <https://www.nngroup.com/articles/progressive-disclosure/>
- Odoo 18.0, Inventory: <https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory.html>
- Odoo 18.0, Point of Sale: <https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale.html>
- Microsoft, Business Central inventory: <https://learn.microsoft.com/en-us/dynamics365/business-central/inventory-manage-inventory>
- Microsoft, Commerce POS operations: <https://learn.microsoft.com/en-us/dynamics365/commerce/pos-operations>
- SAP Help Portal, SAP Business One: <https://help.sap.com/docs/SAP_BUSINESS_ONE>
- Shopify, store permissions: <https://help.shopify.com/en/manual/your-account/users/roles/permissions/store-permissions>
- Shopify, POS permissions: <https://help.shopify.com/en/manual/your-account/users/roles/permissions/pos-permissions>
- Shopify, POS staff management: <https://help.shopify.com/en/manual/sell-in-person/shopify-pos/staff-management/understanding-pos-staff-management>
- Shopify, mobile app: <https://help.shopify.com/en/manual/shopify-mobile-app>
- Toast, access permissions reference: <https://doc.toasttab.com/doc/platformguide/adminPermissions.html>
- Square, permission sets: <https://squareup.com/help/us/en/article/5822-employee-permissions>
- Square, Advanced Access: <https://squareup.com/us/en/staff/advanced-access>
- NIST RBAC project: <https://csrc.nist.gov/projects/role-based-access-control>
- NIST SP 800-162: <https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-162.pdf>
- OWASP Authorization Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html>
- Zanzibar, USENIX ATC 2019: <https://www.usenix.org/conference/atc19/presentation/pang>
- AWS IAM best practices: <https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html>
- MarginEdge, Waste Log: <https://help.marginedge.com/hc/en-us/articles/20415242210579-Waste-Log-Track-Your-Waste>
- MarginEdge, Count Sheet Edits on Mobile: <https://help.marginedge.com/hc/en-us/articles/47246904250515-Count-Sheet-Edits-on-the-Mobile-App>
- MarginEdge, Shared Device Tablet: <https://help.marginedge.com/hc/en-us/articles/47207410379539-Setting-Up-a-Shared-Device-Tablet>

Blocked or partial:

- `www.zoho.com/inventory/` and `www.zoho.com/inventory/help/`: **403** by plain `curl` and by
  `r.jina.ai`. The Zoho Inventory ownership statement is UNVERIFIED.
- `web.archive.org`: **blocked on 2026-09-18** by an abuse rule. This route was the intended
  fallback for Shopify's Cloudflare challenge and for Zoho.
- SAP Help topic HTML: an empty JavaScript shell of 747 bytes. Only the search index answered.
- NIST SP 800-162 appendix on RBAC and the INCITS 359 SSD and DSD clauses: the standard text is
  paid. Those exact clauses are UNVERIFIED here.
- Square's exact inventory permission label: not on the reachable support pages. UNVERIFIED.
- G2, Capterra, and the other review aggregators: **not attempted**, because
  [2026-09-17-inventory-kitchen-systems-deep-dive.md](2026-09-17-inventory-kitchen-systems-deep-dive.md)
  records a hard IP block from this workstation.
