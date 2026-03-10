// Creator metadata registry that stores only pricing hashes.
program creator_reg_v2_xwnxp.aleo {
    @admin(address = "aleo179k9x8m793zgxv5x5w00huef7q73uw0jfne6mtcgu574n5leuczqjd43yl")
    async constructor() {}

    mapping creators: address => bool;
    mapping creator_count: bool => u64;
    mapping creator_ids: u64 => address;
    mapping creator_content_count: address => u64;
    mapping subscription_price_hashes: address => field;
    mapping content_price_hashes: field => field;
    mapping content_registered: field => bool;
    mapping content_creator: field => address;

    async transition register_creator() -> Future {
        return finalize_register_creator(self.caller);
    }

    async function finalize_register_creator(public creator: address) {
        let already_registered: bool = creators.get_or_use(creator, false);
        assert_eq(already_registered, false);
        creators.set(creator, true);

        let count: u64 = creator_count.get_or_use(true, 0u64);
        creator_ids.set(count, creator);
        creator_count.set(true, count + 1u64);
    }

    async transition set_subscription_price(public price_hash: field) -> Future {
        return finalize_set_subscription_price(self.caller, price_hash);
    }

    async function finalize_set_subscription_price(public creator: address, public price_hash: field) {
        let is_registered: bool = creators.get_or_use(creator, false);
        assert_eq(is_registered, true);
        subscription_price_hashes.set(creator, price_hash);
    }

    async transition register_content(public content_id: field, public price_hash: field) -> Future {
        return finalize_register_content(self.caller, content_id, price_hash);
    }

    async function finalize_register_content(public creator: address, public content_id: field, public price_hash: field) {
        let is_registered: bool = creators.get_or_use(creator, false);
        assert_eq(is_registered, true);

        let exists: bool = content_registered.get_or_use(content_id, false);
        if exists {
            let owner: address = content_creator.get(content_id);
            assert_eq(owner, creator);
        } else {
            content_registered.set(content_id, true);
            content_creator.set(content_id, creator);

            let count: u64 = creator_content_count.get_or_use(creator, 0u64);
            creator_content_count.set(creator, count + 1u64);
        }

        content_price_hashes.set(content_id, price_hash);
    }
}
