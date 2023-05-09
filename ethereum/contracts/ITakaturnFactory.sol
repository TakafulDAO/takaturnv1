// SPDX-License-Identifier: GPL-3.0        

pragma solidity ^0.8.9;

/// @title Takaturn Factory Interface
/// @author Aisha EL Allam / Mohammed Haddouti
/// @notice This is used to operate the Takaturn fund
/// @dev v2.0 (post-deploy)
interface ITakaturnFactory {
    function createCollateral(
        uint totalParticipants,
        uint cycleTime,
        uint contributionAmount,
        uint contributionPeriod,
        uint collateralAmount,
        uint fixedCollateralEth,
        address stableCoinAddress,
        address aggregatorAddress
    ) external returns (address);

    function createFund(
        address _stableTokenAddress,
        address[] memory _participantsArray,
        uint _cycleTime,
        uint _contributionAmount,
        uint _contributionPeriod
    ) external returns (address);

    function getDeployedCollaterals()
        external
        view
        returns (address[] memory);

        
    function getDeployedFunds()
        external
        view
        returns (address[] memory);
}